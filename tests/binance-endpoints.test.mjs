import assert from "node:assert/strict";
import test from "node:test";

const endpoints = await import("@/lib/server/binance-endpoints.ts");
const http = await import("@/lib/server/http.ts");

test("falls through Binance's documented Spot API hosts after WAF errors", async () => {
  const attempted = [];
  const result = await endpoints.withBinanceSpotFailover(async (base) => {
    attempted.push(base);
    if (attempted.length < 3) throw new http.ProviderError("HTTP 403", 403);
    return "ok";
  });

  assert.equal(result, "ok");
  assert.deepEqual(attempted, endpoints.BINANCE_SPOT_API_BASES);
});

test("turns repeated Binance WAF blocks into a useful safe error", async () => {
  await assert.rejects(
    endpoints.withBinanceSpotFailover(async () => {
      throw new http.ProviderError("HTTP 403", 403);
    }),
    (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /WAF/);
      assert.match(error.message, /고정 IP/);
      return true;
    },
  );
});

test("does not retry API-key or permission failures", async () => {
  let attempts = 0;
  await assert.rejects(
    endpoints.withBinanceSpotFailover(async () => {
      attempts += 1;
      throw new http.ProviderError("Invalid API-key, IP, or permissions for action.", 401);
    }),
    /Invalid API-key/,
  );
  assert.equal(attempts, 1);
});

test("falls through Binance Futures mirrors after a primary WAF block", async () => {
  const attempted = [];
  const result = await endpoints.withBinanceFuturesFailover(async (base) => {
    attempted.push(base);
    if (attempted.length === 1) throw new http.ProviderError("HTTP 403", 403);
    return "futures-ok";
  });

  assert.equal(result, "futures-ok");
  assert.deepEqual(attempted, endpoints.BINANCE_FUTURES_API_BASES.slice(0, 2));
});
