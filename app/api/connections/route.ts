import { and, desc, eq } from "drizzle-orm";

import { ensureDatabase, getDb } from "@/db";
import { connections, portfolioSnapshots } from "@/db/schema";
import {
  PROVIDER_META,
  isProvider,
  type Provider,
  type ProviderCredentials,
  type ProviderSnapshot,
} from "@/lib/portfolio-types";
import { getApiUser, unauthorized } from "@/lib/server/auth";
import { decryptJson, encryptJson } from "@/lib/server/crypto";
import { cleanProviderError, ProviderError } from "@/lib/server/http";
import { buildPortfolio, connectionSummary } from "@/lib/server/portfolio";
import {
  publicCredentialSummary,
  syncProvider,
} from "@/lib/server/providers";

export const dynamic = "force-dynamic";

function rejectWalletSecrets(credentials: Record<string, unknown>) {
  const forbidden = ["privateKey", "private_key", "seed", "seedPhrase", "mnemonic"];
  if (forbidden.some((key) => key in credentials)) {
    throw new ProviderError(
      "개인키나 시드 문구는 연결에 사용할 수 없습니다. 공개 주소만 입력해 주세요.",
      400,
    );
  }
}

async function ownedConnections(userId: string, provider?: Provider) {
  const db = getDb();
  return db
    .select()
    .from(connections)
    .where(
      provider
        ? and(eq(connections.userId, userId), eq(connections.provider, provider))
        : eq(connections.userId, userId),
    );
}

async function persistSnapshot(
  userId: string,
  connectionId: string,
  provider: Provider,
  snapshot: Awaited<ReturnType<typeof syncProvider>>,
  externalFlowUsd = 0,
) {
  const db = getDb();
  await db.insert(portfolioSnapshots).values({
    id: crypto.randomUUID(),
    connectionId,
    userId,
    provider,
    accountNetUsd: snapshot.accountNetUsd,
    externalFlowUsd,
    payloadJson: JSON.stringify(snapshot),
    syncedAt: snapshot.syncedAt,
  });
}

function hasDerivativeCoverage(snapshot: ProviderSnapshot): boolean {
  if (snapshot.coverage?.derivatives != null) {
    return snapshot.coverage.derivatives;
  }
  return (
    snapshot.positions.length > 0 ||
    snapshot.holdings.some((holding) => holding.category === "collateral")
  );
}

async function coverageExpansionFlowUsd(
  userId: string,
  connectionId: string,
  snapshot: ProviderSnapshot,
): Promise<number> {
  if (!hasDerivativeCoverage(snapshot)) return 0;
  const [latest] = await getDb()
    .select()
    .from(portfolioSnapshots)
    .where(
      and(
        eq(portfolioSnapshots.userId, userId),
        eq(portfolioSnapshots.connectionId, connectionId),
      ),
    )
    .orderBy(desc(portfolioSnapshots.syncedAt))
    .limit(1);
  if (!latest) return snapshot.accountNetUsd;

  try {
    const previous = JSON.parse(latest.payloadJson) as ProviderSnapshot;
    if (hasDerivativeCoverage(previous)) return 0;
    return snapshot.accountNetUsd - latest.accountNetUsd;
  } catch {
    return 0;
  }
}

async function accountCoverageExpansionFlowUsd(
  userId: string,
  connectionId: string,
  nextAccountNetUsd: number,
): Promise<number> {
  const [latest] = await getDb()
    .select({ accountNetUsd: portfolioSnapshots.accountNetUsd })
    .from(portfolioSnapshots)
    .where(
      and(
        eq(portfolioSnapshots.userId, userId),
        eq(portfolioSnapshots.connectionId, connectionId),
      ),
    )
    .orderBy(desc(portfolioSnapshots.syncedAt))
    .limit(1);
  return latest ? nextAccountNetUsd - latest.accountNetUsd : nextAccountNetUsd;
}

function mergeWalletEntries(
  current: ProviderCredentials["walletEntries"],
  additions: ProviderCredentials["walletEntries"],
) {
  const addresses = new Map<string, Set<string>>();
  for (const entry of [...(current ?? []), ...(additions ?? [])]) {
    if (!entry || typeof entry !== "object") continue;
    const address = typeof entry.address === "string" ? entry.address.trim() : "";
    if (!address) continue;
    const chains = addresses.get(address) ?? new Set<string>();
    for (const chain of Array.isArray(entry.chains) ? entry.chains : []) {
      chains.add(String(chain).trim());
    }
    addresses.set(address, chains);
  }
  return Array.from(addresses, ([address, chains]) => ({
    address,
    chains: Array.from(chains).filter(Boolean),
  }));
}

export async function GET(request: Request) {
  const user = await getApiUser(request);
  if (!user) return unauthorized();
  await ensureDatabase();
  try {
    const rows = await ownedConnections(user.id);
    return Response.json(
      { connections: rows.map(connectionSummary) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: cleanProviderError(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const user = await getApiUser(request);
  if (!user) return unauthorized();
  await ensureDatabase();
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 64_000) {
    return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const provider = body.provider;
    if (provider != null && !isProvider(provider)) {
      throw new ProviderError("지원하지 않는 연결 대상입니다.", 400);
    }
    const db = getDb();

    if (action === "connect") {
      if (!isProvider(provider)) {
        throw new ProviderError("연결 대상을 선택해 주세요.", 400);
      }
      const credentials = (body.credentials ?? {}) as ProviderCredentials & Record<string, unknown>;
      rejectWalletSecrets(credentials);

      // Credentials are verified against the provider before anything is saved.
      const snapshot = await syncProvider(provider, credentials);
      const encryptedCredentials = await encryptJson(credentials);
      const now = snapshot.syncedAt;
      const existing = await ownedConnections(user.id, provider);
      const id = existing[0]?.id ?? crypto.randomUUID();
      const values = {
        id,
        userId: user.id,
        provider,
        label: PROVIDER_META[provider].name,
        encryptedCredentials,
        publicSummary: publicCredentialSummary(provider, credentials),
        status: "connected",
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      };
      await db
        .insert(connections)
        .values({ ...values, createdAt: existing[0]?.createdAt ?? now })
        .onConflictDoUpdate({
          target: [connections.userId, connections.provider],
          set: values,
        });
      await persistSnapshot(
        user.id,
        id,
        provider,
        snapshot,
        existing[0]
          ? await coverageExpansionFlowUsd(user.id, id, snapshot)
          : snapshot.accountNetUsd,
      );
      return Response.json(
        {
          ok: true,
          connection: connectionSummary({
            ...values,
            createdAt: existing[0]?.createdAt ?? now,
          }),
          portfolio: await buildPortfolio(user.id),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action === "add_wallet_entries") {
      if (provider !== "okx_wallet") {
        throw new ProviderError("OKX Wallet 연결에서만 체인을 추가할 수 있습니다.", 400);
      }
      const additions = Array.isArray(body.walletEntries)
        ? (body.walletEntries as ProviderCredentials["walletEntries"])
        : [];
      if (!additions.length) {
        throw new ProviderError("추가할 공개 주소와 체인을 입력해 주세요.", 400);
      }
      const [row] = await ownedConnections(user.id, provider);
      if (!row) {
        throw new ProviderError("먼저 OKX Wallet을 연결해 주세요.", 404);
      }

      const credentials = await decryptJson<ProviderCredentials>(row.encryptedCredentials);
      const mergedCredentials: ProviderCredentials = {
        ...credentials,
        walletEntries: mergeWalletEntries(credentials.walletEntries, additions),
      };
      const snapshot = await syncProvider(provider, mergedCredentials);
      const encryptedCredentials = await encryptJson(mergedCredentials);
      await persistSnapshot(
        user.id,
        row.id,
        provider,
        snapshot,
        await accountCoverageExpansionFlowUsd(user.id, row.id, snapshot.accountNetUsd),
      );
      await db
        .update(connections)
        .set({
          encryptedCredentials,
          publicSummary: publicCredentialSummary(provider, mergedCredentials),
          status: "connected",
          lastSyncedAt: snapshot.syncedAt,
          lastError: null,
          updatedAt: snapshot.syncedAt,
        })
        .where(and(eq(connections.id, row.id), eq(connections.userId, user.id)));

      return Response.json(
        {
          ok: true,
          warnings: snapshot.warnings,
          portfolio: await buildPortfolio(user.id),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action === "sync") {
      const rows = await ownedConnections(
        user.id,
        isProvider(provider) ? provider : undefined,
      );
      const results: Array<{
        provider: string;
        ok: boolean;
        error?: string;
        warnings?: string[];
      }> = [];

      for (const row of rows) {
        const rowProvider = row.provider as Provider;
        try {
          const credentials = await decryptJson<ProviderCredentials>(
            row.encryptedCredentials,
          );
          const snapshot = await syncProvider(rowProvider, credentials);
          await persistSnapshot(
            user.id,
            row.id,
            rowProvider,
            snapshot,
            await coverageExpansionFlowUsd(user.id, row.id, snapshot),
          );
          await db
            .update(connections)
            .set({
              status: "connected",
              lastSyncedAt: snapshot.syncedAt,
              lastError: null,
              updatedAt: snapshot.syncedAt,
            })
            .where(
              and(eq(connections.id, row.id), eq(connections.userId, user.id)),
            );
          results.push({
            provider: rowProvider,
            ok: true,
            warnings: snapshot.warnings,
          });
        } catch (error) {
          const message = cleanProviderError(error);
          await db
            .update(connections)
            .set({
              status: "error",
              lastError: message,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(eq(connections.id, row.id), eq(connections.userId, user.id)),
            );
          results.push({ provider: rowProvider, ok: false, error: message });
        }
      }
      return Response.json(
        { ok: results.every((result) => result.ok), results, portfolio: await buildPortfolio(user.id) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action === "disconnect") {
      if (!isProvider(provider)) {
        throw new ProviderError("연결 해제 대상을 선택해 주세요.", 400);
      }
      const rows = await ownedConnections(user.id, provider);
      for (const row of rows) {
        await db
          .delete(portfolioSnapshots)
          .where(
            and(
              eq(portfolioSnapshots.connectionId, row.id),
              eq(portfolioSnapshots.userId, user.id),
            ),
          );
        await db
          .delete(connections)
          .where(and(eq(connections.id, row.id), eq(connections.userId, user.id)));
      }
      return Response.json(
        { ok: true, portfolio: await buildPortfolio(user.id) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    throw new ProviderError("알 수 없는 작업입니다.", 400);
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 500;
    return Response.json(
      { error: cleanProviderError(error) },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
