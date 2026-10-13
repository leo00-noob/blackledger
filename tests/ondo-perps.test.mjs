import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

const { syncOndoPerps } = await import("@/lib/server/ondo-perps.ts");
const address = `0x${"a".repeat(40)}`;
const credentials = {
  apiKey: "ondoKeyId_test",
  secretKey: "ondoApiSecret_test",
  ondoAddress: address,
};

test("signs view requests and includes Ondo Spot and Perps without double counting positions", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path !== "/v1/spot/ticker") {
      const headers = init.headers;
      assert.equal(init.method, "GET");
      assert.equal(headers["ONDO-KEY-ID"], credentials.apiKey);
      assert.equal(
        headers["ONDO-SIGN"],
        createHmac("sha256", credentials.secretKey)
          .update(`${headers["ONDO-TIMESTAMP"]}GET${path}`)
          .digest("hex"),
      );
    }
    const results = {
      "/v1/account": { identifier: address.toUpperCase().replace("0X", "0x") },
      "/v1/spot/balances": [
        { coin: "OAI", total: "2", free: "1", reserved: "1", usdValue: "0" },
        { coin: "USDC", total: "50", free: "50", reserved: "0", usdValue: "50" },
      ],
      "/v1/spot/ticker": [{ baseCurrency: "OAI", quoteCurrency: "USDC", bid: "99", ask: "101" }],
      "/v1/perps/balance": { marginBalance: "300", unrealizedPnl: "20" },
      "/v1/perps/positions": [{ market: "BTC-USD.P", direction: "short", netQuantity: "0.1", notionalValue: "1000", averageEntryPrice: "10100", markPrice: "10000", unrealizedPnl: "10", liquidationPrice: "12000", leverage: "3" }],
    };
    return new Response(JSON.stringify({ success: true, result: results[path] }), { status: 200 });
  };
  try {
    const snapshot = await syncOndoPerps(credentials);
    assert.equal(snapshot.accountNetUsd, 550);
    assert.equal(snapshot.holdings.find((item) => item.symbol === "OAI").amount, 2);
    assert.equal(snapshot.holdings.find((item) => item.symbol === "OAI").priceUsd, 100);
    assert.equal(snapshot.positions[0].side, "SHORT");
    assert.deepEqual(snapshot.coverage, { spot: true, derivatives: true });
    assert.equal(calls.length, 5);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rejects an API key for another EVM account before saving balances", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    result: { identifier: `0x${"b".repeat(40)}` },
  }), { status: 200 });
  try {
    await assert.rejects(syncOndoPerps(credentials), /주소와 다릅니다/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
