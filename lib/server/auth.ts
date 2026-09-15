import { hmac } from "@/lib/server/crypto";

// Single-owner password login. The Sites build relied on identity headers
// injected by the ChatGPT sign-in proxy; on Vercel the dashboard is guarded by
// DASHBOARD_PASSWORD instead. A successful login sets an httpOnly cookie whose
// value is an HMAC of the password under the credential encryption key, so
// changing either secret signs everyone out.

export type ApiUser = {
  id: string;
  email: string | null;
};

export const SESSION_COOKIE = "bl_session";
const OWNER_ID = "owner";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function dashboardPassword(): string {
  const password = process.env.DASHBOARD_PASSWORD?.trim();
  if (!password) {
    throw new Error("DASHBOARD_PASSWORD가 설정되지 않았습니다. Vercel 환경변수에 추가해 주세요.");
  }
  return password;
}

function encryptionKeyMaterial(): string {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY가 설정되지 않았습니다.");
  }
  return key;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sessionToken(): Promise<string> {
  return (await hmac(encryptionKeyMaterial(), `session:${dashboardPassword()}`, "hex")) as string;
}

export async function passwordMatches(candidate: string): Promise<boolean> {
  // Compare HMACs rather than raw strings so the comparison stays constant-time
  // regardless of password length.
  const expected = await hmac(encryptionKeyMaterial(), `login:${dashboardPassword()}`, "hex");
  const provided = await hmac(encryptionKeyMaterial(), `login:${candidate}`, "hex");
  return constantTimeEqual(String(expected), String(provided));
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function isValidSession(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    return constantTimeEqual(token, await sessionToken());
  } catch {
    return false;
  }
}

export async function getApiUser(request: Request): Promise<ApiUser | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return (await isValidSession(token)) ? { id: OWNER_ID, email: null } : null;
}

export function sessionCookie(token: string, maxAge = ONE_YEAR_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function unauthorized() {
  return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
}
