import assert from "node:assert/strict";
import test from "node:test";

process.env.CREDENTIAL_ENCRYPTION_KEY = "test-key";
process.env.DASHBOARD_PASSWORD = "correct horse";

const auth = await import("@/lib/server/auth.ts");

test("login accepts the configured password only", async () => {
  assert.equal(await auth.passwordMatches("correct horse"), true);
  assert.equal(await auth.passwordMatches("wrong"), false);
  assert.equal(await auth.passwordMatches(""), false);
});

test("session cookie round-trips through getApiUser", async () => {
  const token = await auth.sessionToken();
  const ok = await auth.getApiUser(new Request("http://x/", { headers: { cookie: `a=1; ${auth.SESSION_COOKIE}=${token}` } }));
  assert.deepEqual(ok, { id: "owner", email: null });
  const bad = await auth.getApiUser(new Request("http://x/", { headers: { cookie: `${auth.SESSION_COOKIE}=nope` } }));
  assert.equal(bad, null);
  const none = await auth.getApiUser(new Request("http://x/"));
  assert.equal(none, null);
});

test("changing the password invalidates old sessions", async () => {
  const token = await auth.sessionToken();
  process.env.DASHBOARD_PASSWORD = "new password";
  assert.equal(await auth.isValidSession(token), false);
  process.env.DASHBOARD_PASSWORD = "correct horse";
});
