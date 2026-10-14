import assert from "node:assert/strict";
import test from "node:test";

import { trustedOrigin } from "@/lib/server/request-security.ts";

test("preview branch URL is trusted without accepting an arbitrary Origin", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_ORIGIN: process.env.AUTH_ORIGIN,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.AUTH_ORIGIN = "https://blackledger.vercel.app";
    process.env.VERCEL_URL = "blackledger-unique-deployment.vercel.app";
    process.env.VERCEL_BRANCH_URL = "blackledger-git-codex-auth-session-hardening-leo00-noob.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "blackledger.vercel.app";
    const request = (origin) => new Request("https://blackledger-unique-deployment.vercel.app/api/login", {
      method: "POST", headers: { origin },
    });
    assert.equal(trustedOrigin(request("https://blackledger-git-codex-auth-session-hardening-leo00-noob.vercel.app")), true);
    assert.equal(trustedOrigin(request("https://blackledger-unique-deployment.vercel.app")), true);
    assert.equal(trustedOrigin(request("https://blackledger.vercel.app")), true);
    assert.equal(trustedOrigin(request("https://attacker.example")), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
