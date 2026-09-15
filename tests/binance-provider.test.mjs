import assert from "node:assert/strict";
import test from "node:test";

const { syncProvider } = await import("@/lib/server/providers.ts");
const { hmac } = await import("@/lib/server/crypto.ts");

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("includes USD-M wallet balance plus unrealized PnL and keeps AKE short exposure", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(`${url.host}${url.pathname}`);

    if (url.pathname === "/api/v3/account") {
      return json({ balances: [{ asset: "USDC", free: "2.06", locked: "0" }] });
    }
    if (url.pathname === "/api/v3/ticker/price") return json([]);
    if (url.pathname === "/sapi/v1/asset/get-funding-asset") return json([]);

    if (url.host === "fapi.binance.com") return new Response("", { status: 403 });
    if (url.host === "fapi1.binance.com" && url.pathname === "/fapi/v3/account") {
      return json({
        totalWalletBalance: "400",
        totalUnrealizedProfit: "25",
        positions: [],
      });
    }
    if (url.host === "fapi1.binance.com" && url.pathname === "/fapi/v3/balance") {
      return json([{ asset: "USDT", balance: "400", crossUnPnl: "0" }]);
    }
    if (url.host === "fapi1.binance.com" && url.pathname === "/fapi/v2/positionRisk") {
      return json([
        {
          symbol: "AKEUSDT",
          positionAmt: "-20000",
          notional: "-620",
          entryPrice: "0.0324",
          markPrice: "0.031",
          unRealizedProfit: "28",
          liquidationPrice: "0.1",
          leverage: "3",
          marginType: "isolated",
        },
      ]);
    }
    return json({ code: -1, msg: "Unexpected test URL" }, 400);
  };

  try {
    const snapshot = await syncProvider("binance", {
      apiKey: "test-api-key",
      secretKey: "test-secret-key",
    });

    assert.equal(snapshot.accountNetUsd, 427.06);
    assert.equal(snapshot.positions.length, 1);
    assert.equal(snapshot.positions[0].symbol, "AKE");
    assert.equal(snapshot.positions[0].side, "SHORT");
    assert.equal(snapshot.positions[0].notionalUsd, 620);
    assert.ok(requested.includes("fapi1.binance.com/fapi/v3/account"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps Solana and Robinhood balances when another OKX chain fails", async () => {
  const originalFetch = globalThis.fetch;
  const requestedChains = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const chain = url.searchParams.get("chains");
    requestedChains.push(chain);

    if (chain === "501") {
      return json({
        code: "0",
        data: [{ tokenAssets: [{ symbol: "SOL", balance: "2", tokenPrice: "100", chainIndex: "501" }] }],
      });
    }
    if (chain === "4663") {
      return json({
        code: "0",
        data: [{ tokenAssets: [{ symbol: "ETH", balance: "0.025", tokenPrice: "2000", chainIndex: "4663" }] }],
      });
    }
    return json({ code: "500", msg: "Unsupported chain" });
  };

  try {
    const snapshot = await syncProvider("okx_wallet", {
      apiKey: "test-api-key",
      secretKey: "test-secret-key",
      passphrase: "test-passphrase",
      walletEntries: [
        { address: "solana-address", chains: ["501"] },
        { address: "0x1111111111111111111111111111111111111111", chains: ["4663", "999"] },
      ],
    });

    assert.equal(snapshot.accountNetUsd, 250);
    assert.deepEqual(snapshot.holdings.map((holding) => holding.account), ["Solana", "Robinhood Chain"]);
    assert.equal(snapshot.warnings.length, 1);
    assert.match(snapshot.warnings[0], /HyperEVM 조회 실패/);
    assert.deepEqual(new Set(requestedChains), new Set(["501", "4663", "999"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Minimal fake of the browser/Node WebSocket client used by binance-ws.ts.
function fakeWebSocket(handlers, log) {
  return class FakeWebSocket {
    constructor(url) {
      log.push(url);
      this.listeners = {};
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 1;
        (this.listeners.open ?? []).forEach((fn) => fn());
      }, 0);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    send(data) {
      const message = JSON.parse(data);
      log.push(`ws:${message.method}`);
      const handler = handlers[message.method];
      const reply = handler ? handler(message) : { status: 400, error: { code: -1, msg: "unknown method" } };
      setTimeout(() => {
        (this.listeners.message ?? []).forEach((fn) => fn({ data: JSON.stringify({ id: message.id, ...reply }) }));
      }, 0);
    }
    close() {
      this.readyState = 3;
    }
  };
}

test("REST hosts all blocked by WAF → WebSocket API supplies balance and positions", async () => {
  const originalFetch = globalThis.fetch;
  const originalWs = globalThis.WebSocket;
  const log = [];
  let signedOk = false;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    log.push(`${url.host}${url.pathname}`);
    if (url.pathname === "/api/v3/account") return json({ balances: [{ asset: "USDC", free: "2.06", locked: "0" }] });
    if (url.pathname === "/api/v3/ticker/price") return json([{ symbol: "BTCUSDT", price: "100000" }]);
    if (url.pathname === "/sapi/v1/asset/get-funding-asset") return json([]);
    if (url.host.startsWith("fapi")) return new Response("", { status: 403 });
    if (url.host === "papi.binance.com") return json({ code: -2015, msg: "Invalid API-key" }, 401);
    return json({ code: -1, msg: `Unexpected test URL ${url.host}${url.pathname}` }, 400);
  };
  globalThis.WebSocket = fakeWebSocket(
    {
      "v2/account.status": (message) => {
        // verify signature: sorted params, HMAC-SHA256 hex with secret
        const { signature, ...rest } = message.params;
        const payload = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("&");
        return hmac("test-secret-key", payload, "hex").then ? { status: 200, result: { totalWalletBalance: "400", totalUnrealizedProfit: "25", positions: [] }, _check: [signature, payload] } : {};
      },
      "v2/account.balance": () => ({ status: 200, result: [{ asset: "USDT", balance: "400", crossUnPnl: "0" }] }),
      "account.position": () => ({
        status: 200,
        result: [
          { symbol: "BTCUSDT", positionAmt: "0.000", notional: "0", leverage: "20", marginType: "cross" },
          { symbol: "AKEUSDT", positionAmt: "-20000", notional: "-620", entryPrice: "0.0324", markPrice: "0.031", unRealizedProfit: "28", liquidationPrice: "0.1", leverage: "3", marginType: "isolated" },
        ],
      }),
    },
    log,
  );

  try {
    const snapshot = await syncProvider("binance", { apiKey: "test-api-key", secretKey: "test-secret-key" });
    assert.equal(snapshot.accountNetUsd, 427.06);
    assert.equal(snapshot.coverage.derivatives, true);
    assert.equal(snapshot.positions.length, 1);
    assert.deepEqual(
      [snapshot.positions[0].symbol, snapshot.positions[0].side, snapshot.positions[0].notionalUsd, snapshot.positions[0].leverage, snapshot.positions[0].marginMode],
      ["AKE", "SHORT", 620, 3, "Isolated"],
    );
    assert.ok(snapshot.holdings.some((h) => h.account === "USDⓈ-M equity" && h.valueUsd === 425));
    assert.ok(log.includes("wss://ws-fapi.binance.com/ws-fapi/v1"));
    assert.ok(log.includes("ws:account.position"));
    assert.ok(snapshot.warnings.some((w) => /WebSocket API/.test(w)));
    signedOk = true;
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWs;
  }
  assert.ok(signedOk);
});

test("WebSocket signature payload is alphabetically sorted HMAC-SHA256", async () => {
  const originalWs = globalThis.WebSocket;
  const { binanceFuturesWsRequests } = await import("@/lib/server/binance-ws.ts");
  let seen;
  globalThis.WebSocket = fakeWebSocket(
    { "v2/account.balance": (m) => { seen = m.params; return { status: 200, result: [] }; } },
    [],
  );
  try {
    await binanceFuturesWsRequests({ apiKey: "K", secretKey: "S" }, [{ method: "v2/account.balance" }]);
    const { signature, ...rest } = seen;
    const payload = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("&");
    assert.equal(payload, `apiKey=K&recvWindow=7000&timestamp=${rest.timestamp}`);
    assert.equal(typeof rest.timestamp, "number");
    assert.equal(signature, await hmac("S", payload, "hex"));
  } finally {
    globalThis.WebSocket = originalWs;
  }
});

test("REST + WebSocket both blocked → wallet total still gives futures equity", async () => {
  const originalFetch = globalThis.fetch;
  const originalWs = globalThis.WebSocket;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v3/account") return json({ balances: [] });
    if (url.pathname === "/api/v3/ticker/price") return json([{ symbol: "BTCUSDT", price: "100000" }]);
    if (url.pathname === "/sapi/v1/asset/get-funding-asset") return json([]);
    if (url.pathname === "/sapi/v1/asset/wallet/balance")
      return json([{ walletName: "Spot", balance: "0" }, { walletName: "USDⓈ-M Futures", balance: "0.005" }]);
    if (url.host.startsWith("fapi")) return new Response("", { status: 403 });
    return json({ code: -1, msg: "blocked" }, 403);
  };
  globalThis.WebSocket = class { constructor() { setTimeout(() => this.l.error?.forEach((f) => f({})), 0); this.l = {}; } addEventListener(t, f) { (this.l[t] ??= []).push(f); } send() {} close() {} };
  try {
    const snapshot = await syncProvider("binance", { apiKey: "k", secretKey: "s" });
    assert.equal(snapshot.accountNetUsd, 500);
    assert.equal(snapshot.positions.length, 0);
    assert.ok(snapshot.warnings.some((w) => /오픈 포지션은 불러오지 못했습니다/.test(w)));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWs;
  }
});

test("API-key error is not retried over WebSocket", async () => {
  const originalFetch = globalThis.fetch;
  const originalWs = globalThis.WebSocket;
  let wsOpened = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v3/account") return json({ balances: [] });
    if (url.pathname === "/api/v3/ticker/price") return json([]);
    if (url.pathname === "/sapi/v1/asset/get-funding-asset") return json([]);
    return json({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." }, 401);
  };
  globalThis.WebSocket = class { constructor() { wsOpened = true; } addEventListener() {} send() {} close() {} };
  try {
    const snapshot = await syncProvider("binance", { apiKey: "k", secretKey: "s" });
    assert.equal(wsOpened, false);
    assert.ok(snapshot.warnings.some((w) => /Invalid API-key/.test(w)));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWs;
  }
});

test("relay env routes futures REST through the relay with the token header", async () => {
  const originalFetch = globalThis.fetch;
  process.env.BINANCE_FUTURES_RELAY_URL = "https://relay.example.test/api/";
  process.env.BINANCE_RELAY_TOKEN = "tok123";
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push([`${url.host}${url.pathname}`, init?.headers?.["X-Relay-Token"], init?.headers?.["X-MBX-APIKEY"]]);
    if (url.pathname === "/api/v3/account") return json({ balances: [] });
    if (url.pathname === "/api/v3/ticker/price") return json([]);
    if (url.pathname === "/sapi/v1/asset/get-funding-asset") return json([]);
    if (url.host === "relay.example.test" && url.pathname === "/api/fapi/v3/account") return json({ totalWalletBalance: "10", totalUnrealizedProfit: "0", positions: [] });
    if (url.host === "relay.example.test" && url.pathname === "/api/fapi/v3/balance") return json([]);
    if (url.host === "relay.example.test" && url.pathname === "/api/fapi/v2/positionRisk") return json([]);
    return new Response("", { status: 403 });
  };
  try {
    const snapshot = await syncProvider("binance", { apiKey: "k", secretKey: "s" });
    assert.equal(snapshot.accountNetUsd, 10);
    const relayCall = seen.find((s) => s[0] === "relay.example.test/api/fapi/v3/account");
    assert.deepEqual(relayCall, ["relay.example.test/api/fapi/v3/account", "tok123", "k"]);
    assert.ok(!seen.some((s) => s[0].startsWith("fapi.binance.com")), "relay succeeded so fapi should not be hit");
    assert.ok(!seen.some((s) => s[0].startsWith("api-gcp") && s[1]), "token must not leak to Binance hosts");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BINANCE_FUTURES_RELAY_URL;
    delete process.env.BINANCE_RELAY_TOKEN;
  }
});

test("warning names both REST and WebSocket reasons when everything is blocked", async () => {
  const originalFetch = globalThis.fetch;
  const originalWs = globalThis.WebSocket;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v3/account") return json({ balances: [] });
    if (url.pathname === "/api/v3/ticker/price") return json([{ symbol: "BTCUSDT", price: "100000" }]);
    if (url.pathname === "/sapi/v1/asset/get-funding-asset") return json([]);
    if (url.pathname === "/sapi/v1/asset/wallet/balance") return json([{ walletName: "USDⓈ-M Futures", balance: "0.001" }]);
    return new Response("", { status: 403 });
  };
  globalThis.WebSocket = class { constructor() { this.l = {}; setTimeout(() => this.l.close?.forEach((f) => f({ reason: "1008 blocked" })), 0); } addEventListener(t, f) { (this.l[t] ??= []).push(f); } send() {} close() {} };
  try {
    const snapshot = await syncProvider("binance", { apiKey: "k", secretKey: "s" });
    const warning = snapshot.warnings.find((w) => /오픈 포지션은 불러오지 못했습니다/.test(w));
    assert.match(warning, /REST: .*WAF/);
    assert.match(warning, /WebSocket: .*1008 blocked/);
    assert.match(warning, /relay\/README\.md/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWs;
  }
});
