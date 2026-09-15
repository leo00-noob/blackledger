import { asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  connections,
  costBasisOverrides,
  portfolioSnapshots,
} from "@/db/schema";
import {
  PROVIDER_META,
  PROVIDERS,
  type ConnectionSummary,
  type NormalizedHolding,
  type NormalizedPosition,
  type Provider,
  type ProviderSnapshot,
} from "@/lib/portfolio-types";
import { fetchJson, numberValue } from "@/lib/server/http";

const FALLBACK_KRW_USD = 1382;
const STABLES = new Set(["USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD", "USDE", "USDS", "USDG", "KRW"]);

const ASSET_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  BNB: "BNB",
  DOGE: "Dogecoin",
  ADA: "Cardano",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  TRX: "TRON",
  DOT: "Polkadot",
  USDT: "Tether",
  USDC: "USD Coin",
  KRW: "Korean Won",
  ZEC: "Zcash",
  HYPE: "Hyperliquid",
  AKE: "Akedo",
  USDG: "Global Dollar",
};

type AssetAccumulator = {
  symbol: string;
  name: string;
  totalValueUsd: number;
  spotValueUsd: number;
  futuresExposureUsd: number;
  unrealizedPnlUsd: number;
  priceNumerator: number;
  priceWeight: number;
  changeNumerator: number;
  changeWeight: number;
  venues: Set<string>;
  holdings: Array<
    NormalizedHolding & {
      provider: Provider;
      unrealizedPnlUsd: number;
      costBasisSource: "exchange" | "reconstructed" | "manual" | "unavailable";
    }
  >;
};

export function connectionSummary(row: typeof connections.$inferSelect): ConnectionSummary {
  const provider = row.provider as Provider;
  const meta = PROVIDER_META[provider];
  return {
    id: row.id,
    provider,
    name: meta?.name ?? row.label,
    type: meta?.type ?? "Exchange",
    detail: meta?.detail ?? "Read only",
    publicSummary: row.publicSummary,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
  };
}

function safeSnapshot(value: string): ProviderSnapshot | null {
  try {
    const parsed = JSON.parse(value) as ProviderSnapshot;
    return parsed && Array.isArray(parsed.holdings) && Array.isArray(parsed.positions)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function getKrwUsdRate(): Promise<number> {
  const endpoints = [
    "https://api.upbit.com/v1/ticker?markets=KRW-USDT",
    "https://api.bithumb.com/v1/ticker?markets=KRW-USDT",
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetchJson<Array<Record<string, unknown>>>(endpoint);
      const rate = numberValue(response[0]?.trade_price);
      if (rate > 500 && rate < 5000) return rate;
    } catch {
      // Try the next domestic venue, then use the conservative fallback.
    }
  }
  return FALLBACK_KRW_USD;
}

function signedExposure(position: NormalizedPosition): number {
  return position.side === "SHORT" ? -Math.abs(position.notionalUsd) : Math.abs(position.notionalUsd);
}

export async function buildPortfolio(userId: string) {
  const db = getDb();
  const [connectionRows, snapshotRows, overrides, fxKrw] = await Promise.all([
    db
      .select()
      .from(connections)
      .where(eq(connections.userId, userId))
      .orderBy(asc(connections.createdAt)),
    db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.userId, userId))
      .orderBy(desc(portfolioSnapshots.syncedAt))
      .limit(360),
    db
      .select()
      .from(costBasisOverrides)
      .where(eq(costBasisOverrides.userId, userId)),
    getKrwUsdRate(),
  ]);

  const latestRows = new Map<string, (typeof snapshotRows)[number]>();
  for (const row of snapshotRows) {
    if (!latestRows.has(row.connectionId)) latestRows.set(row.connectionId, row);
  }

  const overrideMap = new Map(
    overrides.map((override) => [
      `${override.provider}:${override.symbol.toUpperCase()}`,
      override.averageEntryUsd,
    ]),
  );
  const assets = new Map<string, AssetAccumulator>();
  const allPositions: Array<NormalizedPosition & { provider: Provider }> = [];
  const warnings: string[] = [];

  function asset(symbolValue: string): AssetAccumulator {
    const symbol = symbolValue.toUpperCase();
    const existing = assets.get(symbol);
    if (existing) return existing;
    const created: AssetAccumulator = {
      symbol,
      name: ASSET_NAMES[symbol] ?? symbol,
      totalValueUsd: 0,
      spotValueUsd: 0,
      futuresExposureUsd: 0,
      unrealizedPnlUsd: 0,
      priceNumerator: 0,
      priceWeight: 0,
      changeNumerator: 0,
      changeWeight: 0,
      venues: new Set(),
      holdings: [],
    };
    assets.set(symbol, created);
    return created;
  }

  for (const connection of connectionRows) {
    const row = latestRows.get(connection.id);
    if (!row) continue;
    const snapshot = safeSnapshot(row.payloadJson);
    if (!snapshot) continue;
    const provider = connection.provider as Provider;
    warnings.push(...snapshot.warnings.map((warning) => `${PROVIDER_META[provider].name}: ${warning}`));

    for (const sourceHolding of snapshot.holdings) {
      const target = asset(sourceHolding.symbol);
      const override = overrideMap.get(`${provider}:${target.symbol}`);
      const averageEntryUsd = override ?? sourceHolding.averageEntryUsd ?? null;
      const costBasisSource = override
        ? "manual"
        : sourceHolding.averageEntryUsd
          ? provider === "binance"
            ? "reconstructed"
            : "exchange"
          : "unavailable";
      const unrealizedPnlUsd =
        averageEntryUsd && sourceHolding.category !== "collateral"
          ? (sourceHolding.priceUsd - averageEntryUsd) * sourceHolding.amount
          : 0;
      target.totalValueUsd += sourceHolding.valueUsd;
      if (sourceHolding.category === "spot" || sourceHolding.category === "wallet") {
        target.spotValueUsd += sourceHolding.valueUsd;
      }
      target.unrealizedPnlUsd += unrealizedPnlUsd;
      target.priceNumerator += sourceHolding.priceUsd * Math.abs(sourceHolding.amount);
      target.priceWeight += Math.abs(sourceHolding.amount);
      if (sourceHolding.change24Pct != null) {
        target.changeNumerator += sourceHolding.change24Pct * Math.abs(sourceHolding.valueUsd);
        target.changeWeight += Math.abs(sourceHolding.valueUsd);
      }
      target.venues.add(sourceHolding.venue);
      target.holdings.push({
        ...sourceHolding,
        provider,
        averageEntryUsd,
        unrealizedPnlUsd,
        costBasisSource,
      });
    }

    for (const position of snapshot.positions) {
      const target = asset(position.symbol);
      target.futuresExposureUsd += signedExposure(position);
      target.unrealizedPnlUsd += position.unrealizedPnlUsd;
      target.venues.add(position.venue);
      if (!target.priceWeight && position.markPriceUsd) {
        target.priceNumerator += position.markPriceUsd * Math.abs(position.notionalUsd);
        target.priceWeight += Math.abs(position.notionalUsd);
      }
      allPositions.push({ ...position, provider });
    }
  }

  const totalNetWorthUsd = Array.from(latestRows.values()).reduce(
    (sum, row) => sum + row.accountNetUsd,
    0,
  );
  const liveAssets = Array.from(assets.values())
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      totalValueKrw: item.totalValueUsd * fxKrw,
      spotValueKrw: item.spotValueUsd * fxKrw,
      futuresExposureKrw: item.futuresExposureUsd * fxKrw,
      currentPriceKrw:
        item.priceWeight > 0 ? (item.priceNumerator / item.priceWeight) * fxKrw : 0,
      unrealizedPnlKrw: item.unrealizedPnlUsd * fxKrw,
      change24Pct:
        item.changeWeight > 0 ? item.changeNumerator / item.changeWeight : 0,
      venues: Array.from(item.venues),
      holdings: item.holdings.map((holding) => ({
        provider: holding.provider,
        venue: holding.venue,
        account: holding.account,
        chain: holding.chain ?? null,
        amount: holding.amount,
        symbol: holding.symbol,
        valueKrw: holding.valueUsd * fxKrw,
        priceKrw: holding.priceUsd * fxKrw,
        averageEntryKrw:
          holding.averageEntryUsd != null ? holding.averageEntryUsd * fxKrw : null,
        unrealizedPnlKrw: holding.unrealizedPnlUsd * fxKrw,
        exposure:
          holding.category === "collateral"
            ? "Collateral"
            : holding.category === "cash"
              ? "Cash"
              : "Long",
        costBasisSource: holding.costBasisSource,
      })),
    }))
    .sort((a, b) => b.totalValueKrw - a.totalValueKrw);

  const historyByConnection = new Map<string, number>();
  let previousTotal = 0;
  let cumulativeReturn = 0;
  const history = [...snapshotRows]
    .reverse()
    .map((row) => {
      historyByConnection.set(row.connectionId, row.accountNetUsd);
      const total = Array.from(historyByConnection.values()).reduce((sum, value) => sum + value, 0);
      const flow = row.externalFlowUsd;
      if (previousTotal > 0) {
        const periodReturn = (total - previousTotal - flow) / previousTotal;
        cumulativeReturn = (1 + cumulativeReturn) * (1 + periodReturn) - 1;
      }
      previousTotal = total;
      return {
        at: row.syncedAt,
        valueKrw: total * fxKrw,
        externalFlowKrw: flow * fxKrw,
        returnPct: cumulativeReturn * 100,
      };
    })
    .filter((point, index, rows) => {
      const next = rows[index + 1];
      return !next || Math.abs(new Date(next.at).getTime() - new Date(point.at).getTime()) > 30_000;
    })
    .slice(-120);

  const positions = allPositions
    .map((position) => ({
      provider: position.provider,
      symbol: `${position.symbol}USDT`,
      assetSymbol: position.symbol,
      side: position.side,
      venue: position.venue,
      amount: position.amount,
      sizeKrw: position.notionalUsd * fxKrw,
      entryKrw: position.entryPriceUsd * fxKrw,
      markKrw: position.markPriceUsd * fxKrw,
      unrealizedPnlKrw: position.unrealizedPnlUsd * fxKrw,
      liquidationKrw: position.liquidationPriceUsd * fxKrw,
      leverage: position.leverage,
      marginMode: position.marginMode,
    }))
    .sort((a, b) => b.sizeKrw - a.sizeKrw);

  const accounts = connectionRows.map((connection) => {
    const latest = latestRows.get(connection.id);
    const snapshot = latest ? safeSnapshot(latest.payloadJson) : null;
    return {
      ...connectionSummary(connection),
      valueKrw: (latest?.accountNetUsd ?? 0) * fxKrw,
      coverage: snapshot?.coverage,
    };
  });

  const allocation = accounts.map((account) => ({
    provider: account.provider,
    label: account.name,
    valueKrw: account.valueKrw,
  }));
  const spotKrw = liveAssets.reduce((sum, item) => sum + item.spotValueKrw, 0);
  const stableKrw = liveAssets
    .filter((item) => STABLES.has(item.symbol))
    .reduce((sum, item) => sum + item.totalValueKrw, 0);
  const derivativeEquityKrw = liveAssets.reduce(
    (sum, item) =>
      sum +
      item.holdings
        .filter((holding) => holding.exposure === "Collateral")
        .reduce((inner, holding) => inner + holding.valueKrw, 0),
    0,
  );

  const periodReturn = (days: number) => {
    if (history.length < 2) return null;
    const cutoff = Date.now() - days * 86_400_000;
    const start = history.find((point) => new Date(point.at).getTime() >= cutoff) ?? history[0];
    const end = history.at(-1)!;
    if (start === end) return null;
    return end.returnPct - start.returnPct;
  };

  return {
    mode: connectionRows.length && latestRows.size ? "live" : "empty",
    fxKrw,
    asOf: accounts
      .map((account) => account.lastSyncedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null,
    totalNetWorthKrw: totalNetWorthUsd * fxKrw,
    assets: liveAssets,
    positions,
    accounts,
    allocation,
    composition: { spotKrw, derivativeEquityKrw, stableKrw },
    history,
    returns: {
      day: periodReturn(1),
      week: periodReturn(7),
      month: periodReturn(30),
      all: history.length > 1 ? history.at(-1)!.returnPct : null,
    },
    warnings,
    availableProviders: PROVIDERS,
  };
}
