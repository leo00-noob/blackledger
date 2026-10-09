import { eq } from "drizzle-orm";

import { ensureDatabase } from "@/db";
import { sessions } from "@/db/schema";
import { base64Url } from "@/lib/server/crypto";

export type ApiUser = { id: string; email: string | null };
export const SESSION_COOKIE = "__Host-bl_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const OWNER_ID = "owner";
const encoder = new TextEncoder();

export async function passwordMatches(candidate: string): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD?.trim();
  if (!password) throw new Error("DASHBOARD_PASSWORD is not configured");
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const [expected, provided] = await Promise.all([digest(password), digest(candidate)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected[i] ^ provided[i];
  return difference === 0;
}

export async function tokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(): Promise<string> {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const db = await ensureDatabase();
  await db.insert(sessions).values({ tokenHash: await tokenHash(token), createdAt: now, expiresAt: now + SESSION_SECONDS * 1000 });
  return token;
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function isValidSession(token: string | null | undefined): Promise<boolean> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    const db = await ensureDatabase();
    const [row] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions)
      .where(eq(sessions.tokenHash, await tokenHash(token))).limit(1);
    return !!row && row.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export async function revokeSession(token: string | null | undefined): Promise<void> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  const db = await ensureDatabase();
  await db.delete(sessions).where(eq(sessions.tokenHash, await tokenHash(token)));
}

export async function getApiUser(request: Request): Promise<ApiUser | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return (await isValidSession(token)) ? { id: OWNER_ID, email: null } : null;
}

export function sessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function unauthorized() {
  return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
