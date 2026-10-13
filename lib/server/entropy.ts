import type { NormalizedPosition, ProviderCredentials, ProviderSnapshot } from "@/lib/portfolio-types";
import { fetchJson, ProviderError } from "@/lib/server/http";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function info(type: string, user: string, dex?: string): Promise<unknown> {
  return fetchJson<unknown>(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, user, ...(dex ? { dex } : {}) }),
    cache: "no-store",
  });
}

export async function syncEntropy(credentials: ProviderCredentials): Promise<ProviderSnapshot> {
  const address = credentials.entropyAddress?.trim() ?? "";
  if (!ADDRESS.test(address)) {
    throw new ProviderError("Entropy에서 사용하는 EVM 지갑 주소를 입력해 주세요.", 400);
  }

  // io is Entropy's HIP-3 deployer. Query this DEX explicitly so positions on
  // other Hyperliquid DEXs cannot be attributed to Entropy.
  const [modeResponse, stateResponse] = await Promise.all([
    info("userAbstraction", address),
    info("clearinghouseState", address, "io"),
  ]);
  const mode = typeof modeResponse === "string" ? modeResponse : "";
  const state = row(stateResponse);
  if (!Array.isArray(state.assetPositions) || !state.marginSummary || typeof state.marginSummary !== "object") {
    throw new ProviderError("Entropy 계정 응답에서 잔고 또는 포지션을 확인할 수 없습니다.");
  }

  const positions: NormalizedPosition[] = [];
  const warnings: string[] = [];
  for (const item of state.assetPositions) {
    const position = row(row(item).position);
    const coin = String(position.coin ?? "");
    const size = finite(position.szi);
    if (!coin.startsWith("io:") || !size) continue;
    const symbol = coin.slice(3).toUpperCase();
    if (!symbol) continue;
    const notional = Math.abs(finite(position.positionValue) ?? 0);
    const mark = notional > 0 ? notional / Math.abs(size) : 0;
    const leverage = row(position.leverage);
    positions.push({
      symbol,
      venue: "Entropy Perps",
      side: size > 0 ? "LONG" : "SHORT",
      amount: Math.abs(size),
      notionalUsd: notional,
      entryPriceUsd: finite(position.entryPx) ?? 0,
      markPriceUsd: mark,
      unrealizedPnlUsd: finite(position.unrealizedPnl) ?? 0,
      liquidationPriceUsd: finite(position.liquidationPx) ?? 0,
      leverage: finite(leverage.value) ?? 0,
      marginMode: String(leverage.type ?? "cross").toUpperCase(),
    });
  }

  const unified = mode === "unifiedAccount" || mode === "portfolioMargin";
  const equity = finite(row(state.marginSummary).accountValue);
  if (!unified && equity === null) {
    throw new ProviderError("Entropy 선물 계정 평가액을 확인할 수 없습니다.");
  }
  if (unified) {
    warnings.push("Hyperliquid 통합 계정의 담보는 여러 DEX와 공유됩니다. Entropy 포지션만 표시하며 공유 담보는 중복 합산하지 않습니다.");
  }
  const accountNetUsd = unified ? 0 : equity ?? 0;
  return {
    provider: "entropy",
    accountNetUsd,
    holdings: accountNetUsd === 0 ? [] : [{
      symbol: "USDC",
      venue: "Entropy Perps",
      account: "Perps equity",
      amount: accountNetUsd,
      priceUsd: 1,
      valueUsd: accountNetUsd,
      category: "collateral",
    }],
    positions,
    warnings,
    coverage: { derivatives: true },
    syncedAt: new Date().toISOString(),
  };
}
