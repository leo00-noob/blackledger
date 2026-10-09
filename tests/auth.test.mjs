import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createClient } from "@libsql/client";

const directory = await mkdtemp(join(tmpdir(), "blackledger-auth-"));
process.env.TURSO_DATABASE_URL = `file:${join(directory, "auth.db")}`;
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
process.env.DASHBOARD_PASSWORD = "correct horse";
const auth = await import("@/lib/server/auth.ts");
const login = await import("@/app/api/login/route.ts");
const connections = await import("@/app/api/connections/route.ts");
const costBasis = await import("@/app/api/cost-basis/route.ts");
const portfolio = await import("@/app/api/portfolio/route.ts");
const cryptoUtils = await import("@/lib/server/crypto.ts");
const database = createClient({ url: process.env.TURSO_DATABASE_URL });

after(() => { database.close(); });

const request = (method, path, password, cookie, origin = "http://localhost:3000") => new Request(`http://localhost:3000${path}`, {
  method,
  headers: { origin, ...(cookie ? { cookie } : {}) },
  ...(method === "POST" ? { body: JSON.stringify({ password }) } : {}),
});

test("login, sessions, rate limit, CSRF, and DB failure", async () => {
  assert.equal(await auth.passwordMatches("correct horse"), true);
  assert.equal(await auth.passwordMatches("wrong"), false);
  assert.equal((await login.POST(request("POST", "/api/login", "wrong"))).status, 401);
  const first = await login.POST(request("POST", "/api/login", "correct horse"));
  assert.equal(first.status, 200);
  const cookieHeader = first.headers.get("set-cookie");
  assert.match(cookieHeader, /^__Host-bl_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800$/);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const cookie = cookieHeader.split(";")[0];
  const token = cookie.split("=")[1];
  const rows = await database.execute("SELECT token_hash, expires_at FROM sessions");
  assert.equal(rows.rows.length, 1);
  assert.notEqual(rows.rows[0].token_hash, token);
  assert.equal(await auth.isValidSession(token), true);
  assert.equal(await auth.isValidSession("x".repeat(43)), false);
  assert.deepEqual(await auth.getApiUser(request("GET", "/api/portfolio", null, cookie)), { id: "owner", email: null });
  assert.equal((await portfolio.GET(request("GET", "/api/portfolio"))).status, 401);
  assert.equal((await connections.GET(request("GET", "/api/connections"))).status, 401);
  assert.equal((await costBasis.POST(request("POST", "/api/cost-basis", null))).status, 401);
  assert.equal((await connections.POST(request("POST", "/api/connections", null, cookie, "https://evil.example"))).status, 403);
  assert.equal((await costBasis.DELETE(request("DELETE", "/api/cost-basis", null, cookie, "https://evil.example"))).status, 403);
  assert.equal((await login.POST(request("POST", "/api/login", "correct horse", null, "https://evil.example"))).status, 403);
  await database.execute({ sql: "UPDATE sessions SET expires_at = ? WHERE token_hash = ?", args: [Date.now() - 1, rows.rows[0].token_hash] });
  assert.equal(await auth.isValidSession(token), false);

  const deviceA = (await login.POST(request("POST", "/api/login", "correct horse"))).headers.get("set-cookie").split(";")[0];
  const deviceB = (await login.POST(request("POST", "/api/login", "correct horse"))).headers.get("set-cookie").split(";")[0];
  assert.notEqual(deviceA, deviceB);
  assert.equal((await login.DELETE(request("DELETE", "/api/login", null, deviceA))).status, 200);
  assert.equal(await auth.isValidSession(deviceA.split("=")[1]), false);
  assert.equal(await auth.isValidSession(deviceB.split("=")[1]), true);

  for (let i = 0; i < 5; i += 1) assert.equal((await login.POST(request("POST", "/api/login", "wrong"))).status, 401);
  assert.equal((await login.POST(request("POST", "/api/login", "correct horse"))).status, 429);
  await database.execute("DELETE FROM login_failures");

  const encrypted = await cryptoUtils.encryptJson({ apiKey: "regression-test" });
  assert.deepEqual(await cryptoUtils.decryptJson(encrypted), { apiKey: "regression-test" });
  await database.execute("DROP TABLE sessions");
  assert.equal(await auth.isValidSession(deviceB.split("=")[1]), false);
  assert.equal((await portfolio.GET(request("GET", "/api/portfolio", null, deviceB))).status, 401);
});
