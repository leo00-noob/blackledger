export const PROVIDERS = [
  "okx_wallet",
  "binance",
  "bybit",
  "bitget",
  "upbit",
  "bithumb",
  "arcus",
] as const;

export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_META: Record<
  Provider,
  { name: string; type: "Wallet" | "Exchange"; detail: string }
> = {
  okx_wallet: {
    name: "OKX Wallet",
    type: "Wallet",
    detail: "OnchainOS · multichain",
  },
  binance: {
    name: "Binance",
    type: "Exchange",
    detail: "Spot · Funding · USDⓈ-M",
  },
  bybit: {
    name: "Bybit",
    type: "Exchange",
    detail: "Unified · linear perpetual",
  },
  bitget: {
    name: "Bitget",
    type: "Exchange",
    detail: "Spot · USDT futures",
  },
  upbit: {
    name: "Upbit",
    type: "Exchange",
    detail: "KRW spot",
  },
  bithumb: {
    name: "Bithumb",
    type: "Exchange",
    detail: "KRW spot",
  },
  arcus: {
    name: "Arcus",
    type: "Exchange",
    detail: "Robinhood Chain · perps · stock tokens",
  },
};

export type ProviderCredentials = {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  walletEntries?: Array<{ address: string; chains: string[] }>;
};

export type NormalizedHolding = {
  symbol: string;
  venue: string;
  account: string;
  amount: number;
  priceUsd: number;
  valueUsd: number;
  category: "spot" | "cash" | "collateral" | "wallet";
  chain?: string;
  averageEntryUsd?: number | null;
  change24Pct?: number | null;
};

export type NormalizedPosition = {
  symbol: string;
  venue: string;
  side: "LONG" | "SHORT";
  amount: number;
  notionalUsd: number;
  entryPriceUsd: number;
  markPriceUsd: number;
  unrealizedPnlUsd: number;
  liquidationPriceUsd: number;
  leverage: number;
  marginMode: string;
};

export type ProviderSnapshot = {
  provider: Provider;
  accountNetUsd: number;
  holdings: NormalizedHolding[];
  positions: NormalizedPosition[];
  warnings: string[];
  coverage?: {
    spot?: boolean;
    funding?: boolean;
    derivatives?: boolean;
  };
  syncedAt: string;
};

export type ConnectionSummary = {
  id: string;
  provider: Provider;
  name: string;
  type: "Wallet" | "Exchange";
  detail: string;
  publicSummary: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && PROVIDERS.includes(value as Provider);
}
