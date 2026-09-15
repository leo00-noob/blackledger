import {
  PROVIDER_META,
  type NormalizedHolding,
  type NormalizedPosition,
  type Provider,
  type ProviderCredentials,
  type ProviderSnapshot,
} from "@/lib/portfolio-types";
import {
  BINANCE_MARKET_DATA_BASE,
  binanceFuturesRelay,
  binanceRequestHeaders,
  isBinanceHostError,
  withBinanceFuturesFailover,
  withBinanceSpotFailover,
} from "@/lib/server/binance-endpoints";
import { binanceFuturesWsRequests } from "@/lib/server/binance-ws";
import { hmac, jwtHs256 } from "@/lib/server/crypto";
import {
  cleanProviderError,
  fetchJson,
  numberValue,
  positive,
  ProviderError,
} from "@/lib/server/http";

const STABLES = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "DAI",
  "TUSD",
  "USDE",
  "USDS",
]);

const CHAIN_NAMES: Record<string, string> = {
  "0": "Bitcoin",
  "1": "Ethereum",
  "10": "Optimism",
  "25": "Cronos",
  "56": "BNB Chain",
  "137": "Polygon",
  "143": "Monad",
  "195": "Tron",
  "196": "X Layer",
  "250": "Fantom",
  "324": "zkSync Era",
  "501": "Solana",
  "784": "Sui",
  "999": "HyperEVM",
  "8453": "Base",
  "42161": "Arbitrum",
  "43114": "Avalanche",
  "4663": "Robinhood Chain",
  "46630": "Robinhood Chain Testnet",
  "534352": "Scroll",
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizedSymbol(value: unknown): string {
  return text(value).trim().toUpperCase();
}

function isStable(symbol: string): boolean {
  return STABLES.has(symbol.toUpperCase());
}

function assertApiCredentials(
  credentials: ProviderCredentials,
  passphrase = false,
): Required<Pick<ProviderCredentials, "apiKey" | "secretKey">> & {
  passphrase?: string;
} {
  const apiKey = credentials.apiKey?.trim();
  const secretKey = credentials.secretKey?.trim();
  const phrase = credentials.passphrase?.trim();
  if (!apiKey || !secretKey || (passphrase && !phrase)) {
    throw new ProviderError(
      passphrase
        ? "API Key, Secret Key, Passphrase를 모두 입력해 주세요."
        : "API Key와 Secret Key를 모두 입력해 주세요.",
      400,
    );
  }
  return { apiKey, secretKey, ...(phrase ? { passphrase: phrase } : {}) };
}

async function binanceSigned<T>(
  base: string,
  path: string,
  credentials: ProviderCredentials,
  params: Record<string, string | number> = {},
  method = "GET",
): Promise<T> {
  const { apiKey, secretKey } = assertApiCredentials(credentials);
  const query = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ),
    timestamp: String(Date.now()),
    recvWindow: "7000",
  }).toString();
  const signature = await hmac(secretKey, query, "hex");
  return fetchJson<T>(`${base}${path}?${query}&signature=${signature}`, {
    method,
    headers: { ...binanceRequestHeaders(base), "X-MBX-APIKEY": apiKey },
  });
}

async function binanceSpotSigned<T>(
  path: string,
  credentials: ProviderCredentials,
  params: Record<string, string | number> = {},
  method = "GET",
): Promise<T> {
  return withBinanceSpotFailover((base) =>
    binanceSigned<T>(base, path, credentials, params, method),
  );
}

async function binanceFuturesSigned<T>(
  path: string,
  credentials: ProviderCredentials,
  params: Record<string, string | number> = {},
): Promise<T> {
  return withBinanceFuturesFailover((base) =>
    binanceSigned<T>(base, path, credentials, params),
  );
}

async function binanceMarketData<T>(path: string): Promise<T> {
  try {
    return await fetchJson<T>(`${BINANCE_MARKET_DATA_BASE}${path}`, {
      headers: binanceRequestHeaders(BINANCE_MARKET_DATA_BASE),
    });
  } catch {
    return withBinanceSpotFailover((base) =>
      fetchJson<T>(`${base}${path}`, { headers: binanceRequestHeaders(base) }),
    );
  }
}

type BinanceFuturesData = {
  mode: "USDⓈ-M" | "Portfolio Margin";
  transport: "rest" | "websocket" | "wallet";
  account: UnknownRecord;
  balances: UnknownRecord[];
  positions: UnknownRecord[];
  warnings: string[];
};

type SettledRequests = [
  PromiseSettledResult<unknown>,
  PromiseSettledResult<unknown>,
  PromiseSettledResult<unknown>,
];

function settleBinanceFuturesData(
  mode: BinanceFuturesData["mode"],
  transport: BinanceFuturesData["transport"],
  [accountResult, balanceResult, positionResult]: SettledRequests,
): BinanceFuturesData {
  if (accountResult.status === "rejected" && balanceResult.status === "rejected") {
    throw accountResult.reason;
  }

  const account =
    accountResult.status === "fulfilled" ? record(accountResult.value) : {};
  const balances =
    balanceResult.status === "fulfilled"
      ? array(balanceResult.value).map(record)
      : array(account.assets).map(record);
  const accountPositions = array(account.positions).map(record);
  const positions =
    positionResult.status === "fulfilled"
      ? array(positionResult.value).map(record)
      : accountPositions;
  const warnings: string[] = [];

  if (accountResult.status === "rejected") {
    warnings.push("선물 계정 요약 대신 잔고와 포지션을 합산했습니다.");
  }
  if (positionResult.status === "rejected" && !accountPositions.length) {
    warnings.push(
      `선물 포지션을 불러오지 못했습니다: ${cleanProviderError(positionResult.reason)}`,
    );
  }

  return { mode, transport, account, balances, positions, warnings };
}

async function syncBinanceFuturesRest(
  credentials: ProviderCredentials,
): Promise<BinanceFuturesData> {
  // /fapi/v2/positionRisk is used instead of v3 because only v2 reports
  // leverage and margin type, which the positions table displays.
  const settled = await Promise.allSettled([
    binanceFuturesSigned<UnknownRecord>("/fapi/v3/account", credentials),
    binanceFuturesSigned<unknown[]>("/fapi/v3/balance", credentials),
    binanceFuturesSigned<unknown[]>("/fapi/v2/positionRisk", credentials),
  ]);
  return settleBinanceFuturesData("USDⓈ-M", "rest", settled);
}

async function syncBinanceFuturesWebSocket(
  credentials: ProviderCredentials,
): Promise<BinanceFuturesData> {
  const { apiKey, secretKey } = assertApiCredentials(credentials);
  const settled = await binanceFuturesWsRequests({ apiKey, secretKey }, [
    { method: "v2/account.status" },
    { method: "v2/account.balance" },
    { method: "account.position" },
  ]);
  return settleBinanceFuturesData(
    "USDⓈ-M",
    "websocket",
    settled as SettledRequests,
  );
}

async function syncBinanceFuturesPortfolioMargin(
  credentials: ProviderCredentials,
): Promise<BinanceFuturesData> {
  const settled = await Promise.allSettled([
    binanceSigned<UnknownRecord>(
      "https://papi.binance.com",
      "/papi/v2/um/account",
      credentials,
    ),
    binanceSigned<unknown[]>(
      "https://papi.binance.com",
      "/papi/v1/balance",
      credentials,
    ),
    binanceSigned<unknown[]>(
      "https://papi.binance.com",
      "/papi/v1/um/positionRisk",
      credentials,
    ),
  ]);
  return settleBinanceFuturesData("Portfolio Margin", "rest", settled);
}

async function syncBinanceFutures(
  credentials: ProviderCredentials,
): Promise<BinanceFuturesData> {
  let restError: unknown;
  try {
    return await syncBinanceFuturesRest(credentials);
  } catch (error) {
    restError = error;
  }

  // The REST hosts are CloudFront-fronted and reject Cloudflare egress IPs
  // with 403 (WAF). Only when the failure is about reaching Binance — not an
  // API-key or permission error — the WebSocket API is tried next; it runs on
  // Binance's own load balancers and accepts the same HMAC credentials.
  let wsError: unknown;
  if (isBinanceHostError(restError)) {
    try {
      const data = await syncBinanceFuturesWebSocket(credentials);
      data.warnings.push(
        "선물 REST API가 차단되어 WebSocket API로 선물 잔고와 포지션을 불러왔습니다.",
      );
      return data;
    } catch (error) {
      wsError = error;
    }
  }

  try {
    return await syncBinanceFuturesPortfolioMargin(credentials);
  } catch {
    if (wsError === undefined) throw restError;
    // Keep the REST status (so host-level failures stay retryable) but say
    // why every transport failed — the dashboard shows this text verbatim.
    const status = restError instanceof ProviderError ? restError.status : 502;
    throw new ProviderError(
      `REST: ${cleanProviderError(restError)} / WebSocket: ${cleanProviderError(wsError)}`,
      status,
    );
  }
}

// Last resort when every futures transport is blocked: the Spot host that is
// already reachable reports every wallet's total, including USDⓈ-M Futures,
// valued in BTC. Positions are not available on this path.
async function binanceFuturesWalletFallback(
  credentials: ProviderCredentials,
  prices: Map<string, number>,
  reason: unknown,
): Promise<BinanceFuturesData | null> {
  const btcUsd = prices.get("BTCUSDT") ?? prices.get("BTCUSDC") ?? 0;
  if (!btcUsd) return null;
  const wallets = await binanceSpotSigned<unknown[]>(
    "/sapi/v1/asset/wallet/balance",
    credentials,
  );
  const futuresWallet = array(wallets)
    .map(record)
    .find((wallet) => /USD.?-M Futures/i.test(text(wallet.walletName)));
  if (!futuresWallet) return null;
  const equityUsd = numberValue(futuresWallet.balance) * btcUsd;
  return {
    mode: "USDⓈ-M",
    transport: "wallet",
    account: { totalMarginBalance: equityUsd },
    balances: [],
    positions: [],
    warnings: [
      `선물 API 접근이 차단되어 지갑 총액으로 선물 잔고만 표시했습니다. 오픈 포지션은 불러오지 못했습니다${
        binanceFuturesRelay() ? "" : " (relay/README.md의 고정 IP 중계 설정이 필요합니다)"
      }. 원인: ${cleanProviderError(reason)}`,
    ],
  };
}

function binanceFuturesEquityUsd(data: BinanceFuturesData): number {
  const hasWalletTotals =
    "totalWalletBalance" in data.account ||
    "totalUnrealizedProfit" in data.account;
  if (hasWalletTotals) {
    return (
      numberValue(data.account.totalWalletBalance) +
      numberValue(data.account.totalUnrealizedProfit)
    );
  }
  if ("totalMarginBalance" in data.account) {
    return numberValue(data.account.totalMarginBalance);
  }

  const walletBalanceUsd = data.balances.reduce((sum, row) => {
    const symbol = normalizedSymbol(row.asset);
    if (!isStable(symbol)) return sum;
    return sum + numberValue(row.balance ?? row.walletBalance);
  }, 0);
  const unrealizedPnlUsd = data.positions.length
    ? data.positions.reduce(
        (sum, row) =>
          sum + numberValue(row.unRealizedProfit ?? row.unrealizedProfit),
        0,
      )
    : data.balances.reduce(
        (sum, row) =>
          sum +
          (isStable(normalizedSymbol(row.asset))
            ? numberValue(row.crossUnPnl)
            : 0),
        0,
      );
  return walletBalanceUsd + unrealizedPnlUsd;
}

function binanceMarginMode(row: UnknownRecord): string {
  const raw = text(row.marginType).toLowerCase();
  if (raw === "isolated" || row.isolated === true || row.isolated === "true") {
    return "Isolated";
  }
  if (raw === "cross" || raw === "crossed") return "Cross";
  if (numberValue(row.isolatedWallet) > 0 || numberValue(row.isolatedMargin) > 0) {
    return "Isolated";
  }
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Cross";
}

function binancePrice(symbol: string, prices: Map<string, number>): number {
  if (isStable(symbol)) return 1;
  return prices.get(`${symbol}USDT`) ?? prices.get(`${symbol}USDC`) ?? 0;
}

type BinanceTrade = {
  price?: string;
  qty?: string;
  quoteQty?: string;
  commission?: string;
  commissionAsset?: string;
  isBuyer?: boolean;
};

function movingAverageFromTrades(
  symbol: string,
  trades: BinanceTrade[],
): number | null {
  let quantity = 0;
  let cost = 0;
  for (const trade of trades) {
    const tradeQuantity = positive(trade.qty);
    const quoteQuantity = positive(trade.quoteQty) || tradeQuantity * positive(trade.price);
    if (!tradeQuantity) continue;
    if (trade.isBuyer) {
      quantity += tradeQuantity;
      cost += quoteQuantity;
      if (normalizedSymbol(trade.commissionAsset) === symbol) {
        quantity -= positive(trade.commission);
      } else if (isStable(normalizedSymbol(trade.commissionAsset))) {
        cost += positive(trade.commission);
      }
    } else if (quantity > 0) {
      const disposed = Math.min(quantity, tradeQuantity);
      cost -= (cost / quantity) * disposed;
      quantity -= disposed;
    }
  }
  return quantity > 0 && cost > 0 ? cost / quantity : null;
}

async function syncBinance(
  credentials: ProviderCredentials,
): Promise<ProviderSnapshot> {
  assertApiCredentials(credentials);
  const warnings: string[] = [];
  const [spotResult, tickerResult, futuresResult, fundingResult] =
    await Promise.allSettled([
      binanceSpotSigned<UnknownRecord>(
        "/api/v3/account",
        credentials,
      ),
      binanceMarketData<unknown[]>("/api/v3/ticker/price"),
      syncBinanceFutures(credentials),
      binanceSpotSigned<unknown[]>(
        "/sapi/v1/asset/get-funding-asset",
        credentials,
        {},
        "POST",
      ),
    ]);

  if (spotResult.status === "rejected" && futuresResult.status === "rejected") {
    throw spotResult.reason;
  }

  const prices = new Map<string, number>();
  if (tickerResult.status === "fulfilled") {
    for (const item of tickerResult.value) {
      const row = record(item);
      prices.set(normalizedSymbol(row.symbol), numberValue(row.price));
    }
  } else {
    warnings.push("일부 현물 시세를 불러오지 못했습니다.");
  }

  const holdings: NormalizedHolding[] = [];
  if (spotResult.status === "rejected") {
    warnings.push(
      `현물 계정을 불러오지 못했습니다: ${cleanProviderError(spotResult.reason)}`,
    );
  }
  const spotRows =
    spotResult.status === "fulfilled"
      ? array(spotResult.value.balances).map(record)
      : [];

  const candidates = spotRows
    .map((row) => {
      const symbol = normalizedSymbol(row.asset);
      const amount = positive(row.free) + positive(row.locked);
      const priceUsd = binancePrice(symbol, prices);
      return { row, symbol, amount, priceUsd, valueUsd: amount * priceUsd };
    })
    .filter((item) => item.amount > 0 && (item.priceUsd > 0 || isStable(item.symbol)))
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const averages = new Map<string, number>();
  const reconstructable = candidates
    .filter((item) => !isStable(item.symbol))
    .slice(0, 8);
  const tradeResults = await Promise.allSettled(
    reconstructable.map(async (item) => {
      const trades = await binanceSpotSigned<BinanceTrade[]>(
        "/api/v3/myTrades",
        credentials,
        { symbol: `${item.symbol}USDT`, limit: 1000 },
      );
      return [item.symbol, movingAverageFromTrades(item.symbol, trades)] as const;
    }),
  );
  for (const result of tradeResults) {
    if (result.status === "fulfilled" && result.value[1]) {
      averages.set(result.value[0], result.value[1]);
    }
  }

  for (const item of candidates) {
    holdings.push({
      symbol: item.symbol,
      venue: "Binance",
      account: "Spot",
      amount: item.amount,
      priceUsd: item.priceUsd || 1,
      valueUsd: item.valueUsd || item.amount,
      category: isStable(item.symbol) ? "cash" : "spot",
      averageEntryUsd: averages.get(item.symbol) ?? null,
    });
  }

  if (fundingResult.status === "fulfilled") {
    for (const item of fundingResult.value) {
      const row = record(item);
      const symbol = normalizedSymbol(row.asset);
      const amount =
        positive(row.free) + positive(row.freeze) + positive(row.locked) + positive(row.withdrawing);
      const priceUsd = binancePrice(symbol, prices);
      if (!amount || (!priceUsd && !isStable(symbol))) continue;
      holdings.push({
        symbol,
        venue: "Binance",
        account: "Funding",
        amount,
        priceUsd: priceUsd || 1,
        valueUsd: amount * (priceUsd || 1),
        category: isStable(symbol) ? "cash" : "spot",
      });
    }
  } else {
    warnings.push("Funding 지갑 권한이 없어 Spot·선물만 동기화했습니다.");
  }

  let futures: BinanceFuturesData | null =
    futuresResult.status === "fulfilled" ? futuresResult.value : null;
  if (
    !futures &&
    futuresResult.status === "rejected" &&
    isBinanceHostError(futuresResult.reason)
  ) {
    try {
      futures = await binanceFuturesWalletFallback(
        credentials,
        prices,
        futuresResult.reason,
      );
    } catch {
      futures = null;
    }
  }

  if (futures) {
    warnings.push(...futures.warnings);
    const equity = binanceFuturesEquityUsd(futures);
    if (equity) {
      holdings.push({
        symbol: "USDT",
        venue: "Binance",
        account: `${futures.mode} equity`,
        amount: equity,
        priceUsd: 1,
        valueUsd: equity,
        category: "collateral",
      });
    }
  } else if (futuresResult.status === "rejected") {
    warnings.push(
      `선물 계정을 불러오지 못했습니다: ${cleanProviderError(futuresResult.reason)}`,
    );
  }

  const positions: NormalizedPosition[] = [];
  const riskRows = futures?.positions ?? [];
  for (const item of riskRows) {
    const row = record(item);
    const signedAmount = numberValue(row.positionAmt);
    if (!signedAmount) continue;
    const contract = normalizedSymbol(row.symbol);
    const markPriceUsd = numberValue(row.markPrice);
    const notionalUsd = Math.abs(numberValue(row.notional)) || Math.abs(signedAmount * markPriceUsd);
    positions.push({
      symbol: contract.replace(/(USDT|USDC)$/i, ""),
      venue: "Binance",
      side: signedAmount > 0 ? "LONG" : "SHORT",
      amount: Math.abs(signedAmount),
      notionalUsd,
      entryPriceUsd: numberValue(row.entryPrice),
      markPriceUsd,
      unrealizedPnlUsd: numberValue(row.unRealizedProfit ?? row.unrealizedProfit),
      liquidationPriceUsd: numberValue(row.liquidationPrice),
      leverage: numberValue(row.leverage) || 1,
      marginMode: binanceMarginMode(row),
    });
  }

  return {
    provider: "binance",
    accountNetUsd: holdings.reduce((sum, item) => sum + item.valueUsd, 0),
    holdings,
    positions,
    warnings,
    coverage: {
      spot: spotResult.status === "fulfilled",
      funding: fundingResult.status === "fulfilled",
      derivatives: futures != null,
    },
    syncedAt: new Date().toISOString(),
  };
}

async function bybitGet<T>(
  path: string,
  credentials: ProviderCredentials,
  params: Record<string, string> = {},
): Promise<T> {
  const { apiKey, secretKey } = assertApiCredentials(credentials);
  const timestamp = String(Date.now());
  const recvWindow = "7000";
  const query = new URLSearchParams(params).toString();
  const signature = await hmac(
    secretKey,
    `${timestamp}${apiKey}${recvWindow}${query}`,
    "hex",
  );
  return fetchJson<T>(`https://api.bybit.com${path}${query ? `?${query}` : ""}`, {
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-SIGN": String(signature),
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
    },
  });
}

function assertBybitResponse(response: UnknownRecord) {
  if (numberValue(response.retCode) !== 0) {
    throw new ProviderError(text(response.retMsg) || "Bybit 인증에 실패했습니다.");
  }
}

async function syncBybit(
  credentials: ProviderCredentials,
): Promise<ProviderSnapshot> {
  const [wallet, positionsResponse] = await Promise.all([
    bybitGet<UnknownRecord>(
      "/v5/account/wallet-balance",
      credentials,
      { accountType: "UNIFIED" },
    ),
    bybitGet<UnknownRecord>(
      "/v5/position/list",
      credentials,
      { category: "linear", settleCoin: "USDT", limit: "200" },
    ).catch((error) => ({ retCode: -1, retMsg: cleanProviderError(error), result: { list: [] } })),
  ]);
  assertBybitResponse(wallet);

  const account = record(array(record(wallet.result).list)[0]);
  const holdings: NormalizedHolding[] = [];
  for (const item of array(account.coin)) {
    const row = record(item);
    const symbol = normalizedSymbol(row.coin);
    const equity = numberValue(row.equity ?? row.walletBalance);
    const valueUsd = numberValue(row.usdValue);
    if (!equity && !valueUsd) continue;
    holdings.push({
      symbol,
      venue: "Bybit",
      account: "Unified",
      amount: equity,
      priceUsd: equity ? valueUsd / equity : isStable(symbol) ? 1 : 0,
      valueUsd,
      category: isStable(symbol) ? "collateral" : "spot",
      averageEntryUsd: numberValue(row.avgPrice) || null,
    });
  }

  const positions: NormalizedPosition[] = [];
  if (numberValue(positionsResponse.retCode) === 0) {
    for (const item of array(record(positionsResponse.result).list)) {
      const row = record(item);
      const size = positive(row.size);
      if (!size) continue;
      const contract = normalizedSymbol(row.symbol);
      const markPriceUsd = numberValue(row.markPrice);
      positions.push({
        symbol: contract.replace(/(USDT|USDC)$/i, ""),
        venue: "Bybit",
        side: text(row.side).toLowerCase() === "sell" ? "SHORT" : "LONG",
        amount: size,
        notionalUsd: numberValue(row.positionValue) || size * markPriceUsd,
        entryPriceUsd: numberValue(row.avgPrice),
        markPriceUsd,
        unrealizedPnlUsd: numberValue(row.unrealisedPnl),
        liquidationPriceUsd: numberValue(row.liqPrice),
        leverage: numberValue(row.leverage) || 1,
        marginMode: numberValue(row.tradeMode) === 1 ? "Isolated" : "Cross",
      });
    }
  }

  const accountNetUsd = numberValue(account.totalEquity) || holdings.reduce((sum, item) => sum + item.valueUsd, 0);
  const holdingTotal = holdings.reduce((sum, item) => sum + item.valueUsd, 0);
  if (accountNetUsd && Math.abs(accountNetUsd - holdingTotal) > 0.01) {
    holdings.push({
      symbol: "USDT",
      venue: "Bybit",
      account: "Unified adjustment",
      amount: accountNetUsd - holdingTotal,
      priceUsd: 1,
      valueUsd: accountNetUsd - holdingTotal,
      category: "collateral",
    });
  }

  return {
    provider: "bybit",
    accountNetUsd,
    holdings,
    positions,
    warnings:
      numberValue(positionsResponse.retCode) === 0
        ? []
        : ["선물 포지션 조회 권한이 없어 지갑 잔고만 동기화했습니다."],
    syncedAt: new Date().toISOString(),
  };
}

async function bitgetGet<T>(
  path: string,
  credentials: ProviderCredentials,
  params: Record<string, string> = {},
): Promise<T> {
  const { apiKey, secretKey, passphrase } = assertApiCredentials(credentials, true);
  const timestamp = String(Date.now());
  const query = new URLSearchParams(params).toString();
  const pathWithQuery = `${path}${query ? `?${query}` : ""}`;
  const signature = await hmac(
    secretKey,
    `${timestamp}GET${pathWithQuery}`,
    "base64",
  );
  // api.bitget.com sits behind Cloudflare's WAF, which answers requests that
  // carry no User-Agent (the Workers default) with an HTML 403 instead of a
  // Bitget error body. Bitget also documents Content-Type as required.
  return fetchJson<T>(`https://api.bitget.com${pathWithQuery}`, {
    headers: {
      "ACCESS-KEY": apiKey,
      "ACCESS-SIGN": String(signature),
      "ACCESS-PASSPHRASE": passphrase ?? "",
      "ACCESS-TIMESTAMP": timestamp,
      "Content-Type": "application/json",
      "User-Agent": "BlackLedger/1.0 (personal portfolio dashboard)",
      locale: "en-US",
    },
  });
}

function assertBitgetResponse(response: UnknownRecord) {
  if (text(response.code) !== "00000") {
    throw new ProviderError(text(response.msg) || "Bitget 인증에 실패했습니다.");
  }
}

async function syncBitget(
  credentials: ProviderCredentials,
): Promise<ProviderSnapshot> {
  const [spot, futures, positionsResponse, tickersResponse] = await Promise.all([
    bitgetGet<UnknownRecord>("/api/v2/spot/account/assets", credentials),
    bitgetGet<UnknownRecord>("/api/v2/mix/account/accounts", credentials, {
      productType: "USDT-FUTURES",
    }).catch((error) => ({ code: "-1", msg: cleanProviderError(error), data: [] })),
    bitgetGet<UnknownRecord>("/api/v2/mix/position/all-position", credentials, {
      productType: "USDT-FUTURES",
      marginCoin: "USDT",
    }).catch((error) => ({ code: "-1", msg: cleanProviderError(error), data: [] })),
    fetchJson<UnknownRecord>("https://api.bitget.com/api/v2/spot/market/tickers"),
  ]);
  assertBitgetResponse(spot);

  const prices = new Map<string, { price: number; change: number }>();
  for (const item of array(tickersResponse.data)) {
    const row = record(item);
    prices.set(normalizedSymbol(row.symbol), {
      price: numberValue(row.lastPr),
      change: numberValue(row.change24h) * 100,
    });
  }

  const holdings: NormalizedHolding[] = [];
  for (const item of array(spot.data)) {
    const row = record(item);
    const symbol = normalizedSymbol(row.coin);
    const amount = positive(row.available) + positive(row.frozen) + positive(row.locked);
    const market = prices.get(`${symbol}USDT`);
    const priceUsd = isStable(symbol) ? 1 : market?.price ?? 0;
    const suppliedValue = numberValue(row.usdtValue ?? row.usdValue);
    const valueUsd = suppliedValue || amount * priceUsd;
    if (!amount || !valueUsd) continue;
    holdings.push({
      symbol,
      venue: "Bitget",
      account: "Spot",
      amount,
      priceUsd: priceUsd || valueUsd / amount,
      valueUsd,
      category: isStable(symbol) ? "cash" : "spot",
      averageEntryUsd: numberValue(row.avgPrice) || null,
      change24Pct: market?.change ?? null,
    });
  }

  if (text(futures.code) === "00000") {
    for (const item of array(futures.data)) {
      const row = record(item);
      const equity = numberValue(row.accountEquity ?? row.usdtEquity);
      if (!equity) continue;
      const symbol = normalizedSymbol(row.marginCoin) || "USDT";
      holdings.push({
        symbol,
        venue: "Bitget",
        account: "USDT Futures equity",
        amount: equity,
        priceUsd: isStable(symbol) ? 1 : binancePrice(symbol, new Map()),
        valueUsd: equity,
        category: "collateral",
      });
    }
  }

  const positions: NormalizedPosition[] = [];
  if (text(positionsResponse.code) === "00000") {
    for (const item of array(positionsResponse.data)) {
      const row = record(item);
      const amount = positive(row.total ?? row.available);
      if (!amount) continue;
      const contract = normalizedSymbol(row.symbol);
      const markPriceUsd = numberValue(row.markPrice);
      positions.push({
        symbol: contract.replace(/(USDT|USDC)(-FUTURES)?$/i, ""),
        venue: "Bitget",
        side: text(row.holdSide).toLowerCase() === "short" ? "SHORT" : "LONG",
        amount,
        notionalUsd: numberValue(row.notionalUsd ?? row.marketPrice) || amount * markPriceUsd,
        entryPriceUsd: numberValue(row.openPriceAvg),
        markPriceUsd,
        unrealizedPnlUsd: numberValue(row.unrealizedPL),
        liquidationPriceUsd: numberValue(row.liquidationPrice),
        leverage: numberValue(row.leverage) || 1,
        marginMode: text(row.marginMode) || "—",
      });
    }
  }

  const warnings: string[] = [];
  if (text(futures.code) !== "00000") warnings.push("선물 계정 잔고를 불러오지 못했습니다.");
  if (text(positionsResponse.code) !== "00000") warnings.push("선물 포지션을 불러오지 못했습니다.");

  return {
    provider: "bitget",
    accountNetUsd: holdings.reduce((sum, item) => sum + item.valueUsd, 0),
    holdings,
    positions,
    warnings,
    syncedAt: new Date().toISOString(),
  };
}

async function koreanJwt(
  credentials: ProviderCredentials,
  includeTimestamp: boolean,
): Promise<string> {
  const { apiKey, secretKey } = assertApiCredentials(credentials);
  return jwtHs256(
    {
      access_key: apiKey,
      nonce: crypto.randomUUID(),
      ...(includeTimestamp ? { timestamp: Date.now() } : {}),
    },
    secretKey,
  );
}

type KoreanVenue = "Upbit" | "Bithumb";

async function koreanTicker(
  base: string,
  markets: string[],
): Promise<Map<string, { priceKrw: number; change24Pct: number }>> {
  const result = new Map<string, { priceKrw: number; change24Pct: number }>();
  for (let index = 0; index < markets.length; index += 80) {
    const chunk = markets.slice(index, index + 80);
    if (!chunk.length) continue;
    const rows = await fetchJson<unknown[]>(
      `${base}/v1/ticker?markets=${encodeURIComponent(chunk.join(","))}`,
    );
    for (const item of rows) {
      const row = record(item);
      result.set(normalizedSymbol(row.market), {
        priceKrw: numberValue(row.trade_price),
        change24Pct: numberValue(row.signed_change_rate) * 100,
      });
    }
  }
  return result;
}

async function syncKoreanExchange(
  provider: "upbit" | "bithumb",
  credentials: ProviderCredentials,
): Promise<ProviderSnapshot> {
  const venue: KoreanVenue = provider === "upbit" ? "Upbit" : "Bithumb";
  const base = provider === "upbit" ? "https://api.upbit.com" : "https://api.bithumb.com";
  const token = await koreanJwt(credentials, provider === "bithumb");
  const accounts = await fetchJson<unknown[]>(`${base}/v1/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const accountRows = accounts.map(record);
  const markets = accountRows
    .map((row) => normalizedSymbol(row.currency))
    .filter((symbol) => symbol && symbol !== "KRW")
    .map((symbol) => `KRW-${symbol}`);
  if (!markets.includes("KRW-USDT")) markets.push("KRW-USDT");
  const tickers = await koreanTicker(base, markets);
  const fxKrw = tickers.get("KRW-USDT")?.priceKrw || 1382;
  const holdings: NormalizedHolding[] = [];

  for (const row of accountRows) {
    const symbol = normalizedSymbol(row.currency);
    const amount = positive(row.balance) + positive(row.locked);
    if (!symbol || !amount) continue;
    if (symbol === "KRW") {
      holdings.push({
        symbol,
        venue,
        account: "KRW Spot",
        amount,
        priceUsd: 1 / fxKrw,
        valueUsd: amount / fxKrw,
        category: "cash",
        averageEntryUsd: 1 / fxKrw,
      });
      continue;
    }
    const ticker = tickers.get(`KRW-${symbol}`);
    if (!ticker?.priceKrw) continue;
    holdings.push({
      symbol,
      venue,
      account: "KRW Spot",
      amount,
      priceUsd: ticker.priceKrw / fxKrw,
      valueUsd: (amount * ticker.priceKrw) / fxKrw,
      category: isStable(symbol) ? "cash" : "spot",
      averageEntryUsd: numberValue(row.avg_buy_price) / fxKrw || null,
      change24Pct: ticker.change24Pct,
    });
  }

  return {
    provider,
    accountNetUsd: holdings.reduce((sum, item) => sum + item.valueUsd, 0),
    holdings,
    positions: [],
    warnings: [],
    syncedAt: new Date().toISOString(),
  };
}

async function okxGet<T>(
  path: string,
  params: Record<string, string>,
  credentials: ProviderCredentials,
): Promise<T> {
  const { apiKey, secretKey, passphrase } = assertApiCredentials(credentials, true);
  const query = new URLSearchParams(params).toString();
  const pathWithQuery = `${path}?${query}`;
  const timestamp = new Date().toISOString();
  const signature = await hmac(
    secretKey,
    `${timestamp}GET${pathWithQuery}`,
    "base64",
  );
  return fetchJson<T>(`https://web3.okx.com${pathWithQuery}`, {
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": String(signature),
      "OK-ACCESS-PASSPHRASE": passphrase ?? "",
      "OK-ACCESS-TIMESTAMP": timestamp,
    },
  });
}

async function syncOkxWallet(
  credentials: ProviderCredentials,
): Promise<ProviderSnapshot> {
  assertApiCredentials(credentials, true);
  const pairs = Array.from(
    new Map(
      (Array.isArray(credentials.walletEntries) ? credentials.walletEntries : [])
        .flatMap((entry) => {
          const address = entry.address?.trim();
          if (!address || address.length > 128 || /\s/.test(address)) return [];
          return (entry.chains ?? [])
            .map(String)
            .map((chain) => chain.trim())
            .filter((chain) => /^\d{1,10}$/.test(chain))
            .map((chain) => [`${chain}:${address}`, { address, chain }] as const);
        }),
    ).values(),
  );
  if (!pairs.length) {
    throw new ProviderError("조회할 공개 지갑 주소와 체인을 한 개 이상 입력해 주세요.", 400);
  }
  if (pairs.length > 50) {
    throw new ProviderError("지갑 주소와 체인의 조합은 최대 50개까지 연결할 수 있습니다.", 400);
  }

  const settled: Array<{
    pair: (typeof pairs)[number];
    response?: UnknownRecord;
    error?: string;
  }> = [];
  for (let offset = 0; offset < pairs.length; offset += 5) {
    const batch = pairs.slice(offset, offset + 5);
    settled.push(
      ...(await Promise.all(
        batch.map(async (pair) => {
          try {
            const response = await okxGet<UnknownRecord>(
              "/api/v6/dex/balance/all-token-balances-by-address",
              {
                address: pair.address,
                chains: pair.chain,
                excludeRiskToken: "0",
              },
              credentials,
            );
            if (text(response.code) !== "0") {
              throw new ProviderError(text(response.msg) || "OKX Wallet 조회에 실패했습니다.");
            }
            return { pair, response };
          } catch (error) {
            return { pair, error: cleanProviderError(error) };
          }
        }),
      )),
    );
  }

  const successful = settled.filter((result) => result.response);
  if (!successful.length) {
    throw new ProviderError(
      settled[0]?.error || "OKX Wallet에서 지원되는 체인을 조회하지 못했습니다.",
    );
  }

  const holdings: NormalizedHolding[] = [];
  for (const { response } of successful) {
    if (!response) continue;
    for (const group of array(response.data)) {
      for (const item of array(record(group).tokenAssets)) {
        const row = record(item);
        const symbol = normalizedSymbol(row.symbol);
        const amount = positive(row.balance);
        const priceUsd = positive(row.tokenPrice);
        if (!symbol || !amount || !priceUsd || row.isRiskToken === true) continue;
        const chain = text(row.chainIndex);
        holdings.push({
          symbol,
          venue: "OKX Wallet",
          account: CHAIN_NAMES[chain] ?? `Chain ${chain}`,
          chain,
          amount,
          priceUsd,
          valueUsd: amount * priceUsd,
          category: "wallet",
        });
      }
    }
  }

  return {
    provider: "okx_wallet",
    accountNetUsd: holdings.reduce((sum, item) => sum + item.valueUsd, 0),
    holdings,
    positions: [],
    warnings: settled
      .filter((result) => result.error)
      .map(
        (result) =>
          `${CHAIN_NAMES[result.pair.chain] ?? `Chain ${result.pair.chain}`} 조회 실패: ${result.error}`,
      ),
    syncedAt: new Date().toISOString(),
  };
}

export async function syncProvider(
  provider: Provider,
  credentials: ProviderCredentials,
): Promise<ProviderSnapshot> {
  switch (provider) {
    case "binance":
      return syncBinance(credentials);
    case "bybit":
      return syncBybit(credentials);
    case "bitget":
      return syncBitget(credentials);
    case "upbit":
    case "bithumb":
      return syncKoreanExchange(provider, credentials);
    case "okx_wallet":
      return syncOkxWallet(credentials);
  }
}

export function publicCredentialSummary(
  provider: Provider,
  credentials: ProviderCredentials,
): string {
  if (provider === "okx_wallet") {
    const entries = credentials.walletEntries ?? [];
    const first = entries[0]?.address ?? "";
    const short = first.length > 12 ? `${first.slice(0, 6)}…${first.slice(-4)}` : first;
    const chains = new Set(entries.flatMap((entry) => entry.chains ?? [])).size;
    return `${short}${entries.length > 1 ? ` +${entries.length - 1}` : ""} · ${chains} chains`;
  }
  const key = credentials.apiKey?.trim() ?? "";
  return key ? `API •••• ${key.slice(-4)}` : PROVIDER_META[provider].detail;
}
