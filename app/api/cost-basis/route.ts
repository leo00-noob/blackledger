import { and, eq } from "drizzle-orm";

import { ensureDatabase, getDb } from "@/db";
import { connections, costBasisOverrides } from "@/db/schema";
import { isProvider } from "@/lib/portfolio-types";
import { getApiUser, unauthorized } from "@/lib/server/auth";
import { cleanProviderError, ProviderError } from "@/lib/server/http";
import { buildPortfolio, getKrwUsdRate } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getApiUser(request);
  if (!user) return unauthorized();
  await ensureDatabase();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!isProvider(body.provider)) {
      throw new ProviderError("연결 대상을 확인해 주세요.", 400);
    }
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const averageEntryKrw = Number(body.averageEntryKrw);
    if (!symbol || !Number.isFinite(averageEntryKrw) || averageEntryKrw <= 0) {
      throw new ProviderError("평균단가를 0보다 큰 숫자로 입력해 주세요.", 400);
    }

    const db = getDb();
    const [owned] = await db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.userId, user.id),
          eq(connections.provider, body.provider),
        ),
      )
      .limit(1);
    if (!owned) throw new ProviderError("먼저 해당 계정을 연결해 주세요.", 404);

    const fxKrw = await getKrwUsdRate();
    const now = new Date().toISOString();
    await db
      .insert(costBasisOverrides)
      .values({
        userId: user.id,
        provider: body.provider,
        symbol,
        averageEntryUsd: averageEntryKrw / fxKrw,
        note: "Manual override",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          costBasisOverrides.userId,
          costBasisOverrides.provider,
          costBasisOverrides.symbol,
        ],
        set: {
          averageEntryUsd: averageEntryKrw / fxKrw,
          note: "Manual override",
          updatedAt: now,
        },
      });
    return Response.json(
      { ok: true, portfolio: await buildPortfolio(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: cleanProviderError(error) },
      {
        status: error instanceof ProviderError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getApiUser(request);
  if (!user) return unauthorized();
  await ensureDatabase();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!isProvider(body.provider)) {
      throw new ProviderError("연결 대상을 확인해 주세요.", 400);
    }
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    if (!symbol) throw new ProviderError("자산 심볼을 확인해 주세요.", 400);
    const db = getDb();
    await db
      .delete(costBasisOverrides)
      .where(
        and(
          eq(costBasisOverrides.userId, user.id),
          eq(costBasisOverrides.provider, body.provider),
          eq(costBasisOverrides.symbol, symbol),
        ),
      );
    return Response.json(
      { ok: true, portfolio: await buildPortfolio(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: cleanProviderError(error) },
      {
        status: error instanceof ProviderError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

