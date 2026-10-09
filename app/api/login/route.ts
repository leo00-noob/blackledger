import {
  createSession,
  passwordMatches,
  readCookie,
  revokeSession,
  SESSION_COOKIE,
  sessionCookie,
} from "@/lib/server/auth";
import { clearLoginFailures, forbiddenOrigin, loginIp, registerLoginAttempt, trustedOrigin } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!trustedOrigin(request)) return forbiddenOrigin();
  const ip = loginIp(request);
  if (!ip) return Response.json({ error: "로그인을 처리할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    // Fall through with an empty password.
  }

  try {
    if (!(await registerLoginAttempt(ip))) {
      return Response.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } });
    }
    if (!password || !(await passwordMatches(password))) {
      return Response.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const oldToken = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
    const token = await createSession();
    await revokeSession(oldToken);
    await clearLoginFailures(ip);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "로그인을 처리할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  if (!trustedOrigin(request)) return forbiddenOrigin();
  try {
    await revokeSession(readCookie(request.headers.get("cookie"), SESSION_COOKIE));
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "로그아웃을 처리할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
