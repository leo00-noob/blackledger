import { hmac } from "@/lib/server/crypto";
import { fetchJson, numberValue, ProviderError } from "@/lib/server/http";
import type {
  NormalizedHolding,
  NormalizedPosition,
  ProviderCredentials,
  ProviderSnapshot,
} from "@/lib/portfolio-types";

const BASE_URL = "https://api.ondoperps.xyz";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STABLES = new Set(["USDC", "USDT", "USD"]);

type ApiEnvelope = { success?: boolean; result?: unknown; error?: string };
type ApiRecord = Record<string, unknown>;

function object(value: unknown): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ApiRecord
    : {};
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed)
    ? parsed
    : null;
}

async function signedGet(path: string, credentials: ProviderCredentials): Promise<unknown> {
  const key = credentials.apiKey?.trim();
  const secret = credentials.secretKey?.trim();
  if (!key?.startsWith("ondoKeyId_") || !secret?.startsWith("ondoApiSecret_")) {
    throw new ProviderError("Ondo API Key ID와 API Secret을 전체 접두사와 함께 입력해 주세요.", 400);
  }
  const timestamp = String(Date.now());
  const signature = await hmac(secret, `${timestamp}GET${path}`, "hex") as string;
  let response: ApiEnvelope;
  try {
    response = await fetchJson<ApiEnvelope>(`${BASE_URL}${path}`, {
      method: "GET",
      headers: {
        "ONDO-KEY-ID": key,
        "ONDO-TIMESTAMP": timestamp,
        "ONDO-SIGN": signature,
      },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
      throw new ProviderError("Ondo 조회 인증에 실패했습니다. View 권한과 API 키, 허용 IP를 확인해 주세요.", error.status);
    }
    throw error;
  }
  if (response?.success !== true || response.result == null) {
    throw new ProviderError(response?.error || "Ondo API 응답을 확인할 수 없습니다.");
  }
  return response.result;
}

function quoteUsd(ticker: ApiRecord): number {
  const bid = finite(ticker.bid);
  const ask = finite(ticker.ask);
  if (bid && bid > 0 && ask && ask > 0) return (bid + ask) / 2;
  return Math.max(0, finite(ticker.lastPrice) ?? 0);
}

export async function syncOndoPerps(credentials: ProviderCredentials): Promise<ProviderSnapshot> {
  const expectedAddress = credentials.ondoAddress?.trim() ?? "";
  if (!EVM_ADDRESS.test(expectedAddress)) {
    throw new ProviderError("Ondo에 연결한 1702 EVM 지갑 주소를 입력해 주세요.", 400);
  }

  const account = object(await signedGet("/v1/account", credentials));
  const actualAddress = String(account.identifier ?? "");
  if (actualAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new ProviderError("Ondo API 키의 계정 주소가 입력한 EVM 지갑 주소와 다릅니다.", 400);
  }

  const rawBalances = await signedGet("/v1/spot/balances", credentials);
  if (!Array.isArray(rawBalances)) {
    throw new ProviderError("Ondo 현물 잔고 응답 형식이 올바르지 않습니다.");
  }
  const balances = rawBalances.map(object);
  const needsPrices = balances.some((row) => {
    const coin = String(row.coin ?? "").toUpperCase();
    return (finite(row.total) ?? 0) > 0 && !STABLES.has(coin) && (finite(row.usdValue) ?? 0) <= 0;
  });
  const warnings: string[] = [];
  const tickerByCoin = new Map<string, number>();
  if (needsPrices) {
    try {
      const tickers = await signedGet("/v1/spot/ticker", credentials);
      if (!Array.isArray(tickers)) throw new Error("invalid ticker result");
      for (const raw of tickers) {
        const row = object(raw);
        const coin = String(row.baseCurrency ?? "").toUpperCase();
        const quote = String(row.quoteCurrency ?? "").toUpperCase();
        if (STABLES.has(quote) && coin && !tickerByCoin.has(coin)) {
          const price = quoteUsd(row);
          if (price > 0) tickerByCoin.set(coin, price);
        }
      }
    } catch {
      warnings.push("Ondo 현물 시세를 조회하지 못해 일부 자산 평가액이 0으로 표시될 수 있습니다.");
    }
  }

  const holdings: NormalizedHolding[] = [];
  for (const row of balances) {
    const symbol = String(row.coin ?? "").trim().toUpperCase();
    const amount = finite(row.total) ?? 0;
    if (!symbol || amount <= 0) continue;
    const reportedValue = finite(row.usdValue) ?? 0;
    const priceUsd = reportedValue > 0
      ? reportedValue / amount
      : STABLES.has(symbol) ? 1 : tickerByCoin.get(symbol) ?? 0;
    if (priceUsd <= 0) warnings.push(`${symbol} 현물 잔고의 USD 평가액을 확인할 수 없습니다.`);
    holdings.push({
      symbol,
      venue: "Ondo Perps",
      account: "Spot",
      amount,
      priceUsd,
      valueUsd: amount * priceUsd,
      category: STABLES.has(symbol) ? "cash" : "spot",
    });
  }

  const positions: NormalizedPosition[] = [];
  let derivatives = false;
  try {
    const [balanceResult, positionsResult] = await Promise.all([
      signedGet("/v1/perps/balance", credentials),
      signedGet("/v1/perps/positions", credentials),
    ]);
    const balance = object(balanceResult);
    if (!Array.isArray(positionsResult)) throw new ProviderError("Ondo 선물 포지션 응답 형식이 올바르지 않습니다.");
    const marginBalance = finite(balance.marginBalance);
    if (marginBalance === null) throw new ProviderError("Ondo 선물 계정 평가액을 확인할 수 없습니다.");
    if (marginBalance !== 0) {
      holdings.push({
        symbol: "USD",
        venue: "Ondo Perps",
        account: "Perps equity",
        amount: marginBalance,
        priceUsd: 1,
        valueUsd: marginBalance,
        category: "collateral",
      });
    }
    for (const raw of positionsResult) {
      const row = object(raw);
      const market = String(row.market ?? "");
      const amount = Math.abs(numberValue(row.netQuantity));
      if (!market || amount === 0) continue;
      positions.push({
        symbol: market.replace(/-USD\.P$/i, "").toUpperCase(),
        venue: "Ondo Perps",
        side: String(row.direction).toLowerCase() === "short" ? "SHORT" : "LONG",
        amount,
        notionalUsd: Math.abs(numberValue(row.notionalValue)),
        entryPriceUsd: numberValue(row.averageEntryPrice),
        markPriceUsd: numberValue(row.markPrice),
        unrealizedPnlUsd: numberValue(row.unrealizedPnl),
        liquidationPriceUsd: numberValue(row.liquidationPrice),
        leverage: numberValue(row.leverage),
        marginMode: "Cross",
      });
    }
    derivatives = true;
  } catch (error) {
    warnings.push(`Ondo 선물 계정 조회 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
  }

  return {
    provider: "ondo_perps",
    accountNetUsd: holdings.reduce((sum, holding) => sum + holding.valueUsd, 0),
    holdings,
    positions,
    warnings,
    coverage: { spot: true, derivatives },
    syncedAt: new Date().toISOString(),
  };
}
