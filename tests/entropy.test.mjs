import assert from "node:assert/strict";
import test from "node:test";

const { syncEntropy } = await import("@/lib/server/entropy.ts");
const address = `0x${"a".repeat(40)}`;

function mockInfo(mode) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.hyperliquid.xyz/info");
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body);
    calls.push(body);
    return new Response(JSON.stringify(body.type === "userAbstraction" ? mode : body.type === "spotClearinghouseState" ? {
      balances: [{ coin: "USDC", token: 0, total: "90", hold: "30" }],
    } : {
      marginSummary: { accountValue: "125.5" },
      assetPositions: [{ position: {
        coin: "io:OAI", szi: "-2", positionValue: "200", entryPx: "95",
        unrealizedPnl: "-10", liquidationPx: "120",
        leverage: { type: "cross", value: 3 },
      } }],
    }), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

test("reads only the Entropy DEX and reports standard account equity once", async () => {
  const mock = mockInfo("disabled");
  try {
    const snapshot = await syncEntropy({ entropyAddress: address });
    assert.deepEqual(mock.calls, [
      { type: "userAbstraction", user: address },
      { type: "clearinghouseState", user: address, dex: "io" },
    ]);
    assert.equal(snapshot.accountNetUsd, 125.5);
    assert.equal(snapshot.holdings[0].valueUsd, 125.5);
    assert.equal(snapshot.positions[0].symbol, "OAI");
    assert.equal(snapshot.positions[0].side, "SHORT");
    assert.equal(snapshot.positions[0].markPriceUsd, 100);
    assert.equal(snapshot.positions[0].notionalUsd, 200);
  } finally { mock.restore(); }
});

test("includes shared unified collateral once and Entropy's unrealized PnL", async () => {
  const mock = mockInfo("unifiedAccount");
  try {
    const snapshot = await syncEntropy({ entropyAddress: address });
    assert.equal(snapshot.accountNetUsd, 80);
    assert.equal(snapshot.holdings[0].valueUsd, 80);
    assert.equal(snapshot.holdings[0].account, "Unified equity · io PnL");
    assert.equal(snapshot.positions.length, 1);
    assert.deepEqual(snapshot.warnings, []);
    assert.deepEqual(mock.calls[2], { type: "spotClearinghouseState", user: address });
  } finally { mock.restore(); }
});

test("rejects invalid addresses before making API calls", async () => {
  await assert.rejects(syncEntropy({ entropyAddress: "not-an-address" }), /지갑 주소/);
});
