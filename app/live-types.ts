import type { Provider } from "@/lib/portfolio-types";

export type LiveHolding = {
  provider: Provider;
  venue: string;
  account: string;
  chain: string | null;
  amount: number;
  symbol: string;
  valueKrw: number;
  priceKrw: number;
  averageEntryKrw: number | null;
  unrealizedPnlKrw: number;
  exposure: string;
  costBasisSource: "exchange" | "reconstructed" | "manual" | "unavailable";
};

export type LiveAsset = {
  symbol: string;
  name: string;
  totalValueKrw: number;
  spotValueKrw: number;
  futuresExposureKrw: number;
  currentPriceKrw: number;
  unrealizedPnlKrw: number;
  change24Pct: number;
  venues: string[];
  holdings: LiveHolding[];
};

export type LiveAccount = {
  id: string;
  provider: Provider;
  name: string;
  type: "Wallet" | "Exchange";
  detail: string;
  publicSummary: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  valueKrw: number;
  coverage?: {
    spot?: boolean;
    funding?: boolean;
    derivatives?: boolean;
  };
};

export type PortfolioResponse = {
  mode: "live" | "empty";
  fxKrw: number;
  asOf: string | null;
  totalNetWorthKrw: number;
  assets: LiveAsset[];
  positions: Array<{
    provider: Provider;
    symbol: string;
    assetSymbol: string;
    side: "LONG" | "SHORT";
    venue: string;
    amount: number;
    sizeKrw: number;
    entryKrw: number;
    markKrw: number;
    unrealizedPnlKrw: number;
    liquidationKrw: number;
    leverage: number;
    marginMode: string;
  }>;
  accounts: LiveAccount[];
  allocation: Array<{ provider: Provider; label: string; valueKrw: number }>;
  composition: {
    spotKrw: number;
    derivativeEquityKrw: number;
    stableKrw: number;
  };
  history: Array<{
    at: string;
    valueKrw: number;
    externalFlowKrw: number;
    returnPct: number;
  }>;
  returns: {
    day: number | null;
    week: number | null;
    month: number | null;
    all: number | null;
  };
  warnings: string[];
};
