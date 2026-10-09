import { sql } from "drizzle-orm";

import { ensureDatabase } from "@/db";

const WINDOW_MS = 15 * 60 * 1000;

export function trustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = [process.env.AUTH_ORIGIN, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((value): value is string => !!value)
    .map((value) => value.startsWith("http") ? value : `https://${value}`);
  if (process.env.NODE_ENV !== "production") allowed.push(new URL(request.url).origin);
  try {
    return allowed.some((value) => new URL(value).origin === new URL(origin).origin);
  } catch {
    return false;
  }
}

export function forbiddenOrigin(): Response {
  return Response.json({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export function loginIp(request: Request): string | null {
  if (!process.env.VERCEL) return process.env.NODE_ENV === "production" ? null : "local";
  // Vercel overwrites this header at its edge; arbitrary Host and forwarded Host are ignored.
  const ip = request.headers.get("x-vercel-forwarded-for")?.trim();
  return ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

async function failureCount(key: string, now: number): Promise<number> {
  const db = await ensureDatabase();
  const rows = await db.all<{ count: number }>(sql`SELECT count FROM login_failures WHERE key = ${key} AND window_start > ${now - WINDOW_MS}`);
  return rows[0]?.count ?? 0;
}

export async function registerLoginAttempt(ip: string): Promise<boolean> {
  const db = await ensureDatabase();
  const now = Date.now();
  // Each UPSERT is atomic across all serverless instances.
  for (const key of [`ip:${ip}`, "global"]) {
    await db.run(sql`INSERT INTO login_failures (key, window_start, count) VALUES (${key}, ${now}, 1)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN window_start <= ${now - WINDOW_MS} THEN 1 ELSE count + 1 END,
        window_start = CASE WHEN window_start <= ${now - WINDOW_MS} THEN ${now} ELSE window_start END`);
  }
  return (await failureCount(`ip:${ip}`, now)) <= 5 && (await failureCount("global", now)) <= 50;
}

export async function clearLoginFailures(ip: string): Promise<void> {
  const db = await ensureDatabase();
  await db.run(sql`DELETE FROM login_failures WHERE key = ${`ip:${ip}`}`);
  await db.run(sql`DELETE FROM login_failures WHERE key = 'global'`);
}
