import {
  passwordMatches,
  sessionCookie,
  sessionToken,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    // Fall through with an empty password.
  }

  if (!password || !(await passwordMatches(password))) {
    return Response.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie(await sessionToken()), "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" } },
  );
}
