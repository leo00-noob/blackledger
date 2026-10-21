import assert from "node:assert/strict";
import test from "node:test";

const { syncProvider } = await import("@/lib/server/providers.ts");
const { hmac } = await import("@/lib/server/crypto.ts");
const credentials = { apiKey: "test-key", secretKey: "test-secret", passphrase: "test-phrase" };
const ok = (data) => ({ code: "00000", data });
const assetData = { accountEquity: "1025", assets: [
  { coin: "USDT", equity: "500", usdValue: "500" },
  { coin: "BTC", equity: "0.005", usdValue: "500" },
] };
const position = {
  symbol: "AKEUSDT", posSide: "short", holdMode: "one_way_mode",
  total: "20000", available: "0", frozen: "20000", avgPrice: "0.0324",
  markPrice: "0.031", unrealisedPnl: "28", liquidationPrice: "0.1",
  leverage: "3", marginMode: "isolated",
};

function mock(t, respond) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.origin, "https://api.bitget.com");
    assert.equal(init.method ?? "GET", "GET");
    if (!url.pathname.includes("/market/")) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("ACCESS-KEY"), credentials.apiKey);
      assert.equal(headers.get("ACCESS-PASSPHRASE"), credentials.passphrase);
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.ok(headers.get("User-Agent"));
      const signature = await hmac(credentials.secretKey,
        `${headers.get("ACCESS-TIMESTAMP")}GET${url.pathname}${url.search}`, "base64");
      assert.equal(headers.get("ACCESS-SIGN"), signature);
    } else {
      assert.equal(new Headers(init.headers).get("ACCESS-KEY"), null);
    }
    const result = respond(url);
    assert.notEqual(result, undefined, `Unexpected URL ${url}`);
    return result instanceof Response ? result : new Response(JSON.stringify(result));
  });
  return calls;
}

function unified(url) {
  if (url.pathname === "/api/v3/account/assets") return ok(assetData);
  if (url.pathname === "/api/v3/position/current-position") {
    const category = url.searchParams.get("category");
    assert.equal(url.searchParams.has("productType"), false);
    assert.equal(url.searchParams.has("marginCoin"), false);
    return ok({ list: category === "USDT-FUTURES" ? [position, { ...position, total: "0" }] : [] });
  }
}

test("UTA uses signed v3 requests, preserves frozen shorts, and counts shared equity once", async (t) => {
  const calls = mock(t, unified);
  const result = await syncProvider("bitget", credentials);
  assert.equal(result.accountNetUsd, 1025);
  assert.equal(result.holdings.reduce((sum, row) => sum + row.valueUsd, 0), 1025);
  assert.equal(result.holdings.find((row) => row.symbol === "BTC").amount, 0.005);
  assert.deepEqual(result.positions, [{
    symbol: "AKE", venue: "Bitget", side: "SHORT", amount: 20000, notionalUsd: 620,
    entryPriceUsd: 0.0324, markPriceUsd: 0.031, unrealizedPnlUsd: 28,
    liquidationPriceUsd: 0.1, leverage: 3, marginMode: "isolated",
  }]);
  assert.ok(calls.every((url) => url.pathname.startsWith("/api/v3/")));
  assert.deepEqual(calls.slice(1).map((url) => url.searchParams.get("category")).sort(),
    ["USDC-FUTURES", "USDT-FUTURES"]);
});

test("UTA keeps both hedge sides and USDC positions including negative PnL", async (t) => {
  mock(t, (url) => url.pathname.endsWith("/current-position") ? ok({ list:
    url.searchParams.get("category") === "USDC-FUTURES" ? [
      { ...position, symbol: "ETHUSDC", posSide: "long", total: "2", markPrice: "2000", unrealisedPnl: "-10" },
      { ...position, symbol: "ETHUSDC", total: "3", markPrice: "2000" },
    ] : [],
  }) : unified(url));
  const result = await syncProvider("bitget", credentials);
  assert.deepEqual(result.positions.map((row) => [row.symbol, row.side, row.notionalUsd, row.unrealizedPnlUsd]),
    [["ETH", "LONG", 4000, -10], ["ETH", "SHORT", 6000, 28]]);
});

test("UTA accepts a direct data array containing open positions", async (t) => {
  mock(t, (url) => {
    if (url.pathname.endsWith("/current-position")) {
      return ok(url.searchParams.get("category") === "USDT-FUTURES" ? [position] : []);
    }
    return unified(url);
  });
  const result = await syncProvider("bitget", credentials);
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].symbol, "AKE");
  assert.equal(result.positions[0].side, "SHORT");
  assert.equal(result.positions[0].amount, 20000);
  assert.equal(result.positions[0].unrealizedPnlUsd, 28);
});

test("an empty direct USDC array does not block documented USDT positions", async (t) => {
  mock(t, (url) => url.pathname.endsWith("/current-position") &&
    url.searchParams.get("category") === "USDC-FUTURES" ? ok([]) : unified(url));
  const result = await syncProvider("bitget", credentials);
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].symbol, "AKE");
});

test("both empty direct arrays successfully clear positions", async (t) => {
  mock(t, (url) => url.pathname.endsWith("/current-position") ? ok([]) : unified(url));
  assert.deepEqual((await syncProvider("bitget", credentials)).positions, []);
});

test("USDC list:null does not block open USDT positions", async (t) => {
  mock(t, (url) => url.pathname.endsWith("/current-position") &&
    url.searchParams.get("category") === "USDC-FUTURES" ? ok({ list: null }) : unified(url));
  const result = await syncProvider("bitget", credentials);
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].symbol, "AKE");
  assert.equal(result.positions[0].side, "SHORT");
  assert.equal(result.positions[0].amount, 20000);
  assert.equal(result.accountNetUsd, 1025);
});

test("USDT list:null does not block open USDC positions", async (t) => {
  mock(t, (url) => {
    if (!url.pathname.endsWith("/current-position")) return unified(url);
    return ok({ list: url.searchParams.get("category") === "USDT-FUTURES" ? null :
      [{ ...position, symbol: "ETHUSDC" }] });
  });
  const result = await syncProvider("bitget", credentials);
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].symbol, "ETH");
});

test("two successful list:null categories produce an empty position snapshot", async (t) => {
  mock(t, (url) => url.pathname.endsWith("/current-position") ? ok({ list: null }) : unified(url));
  assert.deepEqual((await syncProvider("bitget", credentials)).positions, []);
});

test("list:null on a failed API envelope never becomes an empty snapshot", async (t) => {
  mock(t, (url) => url.pathname.endsWith("/current-position") &&
    url.searchParams.get("category") === "USDC-FUTURES" ?
    { code: "25620", msg: "permission denied", data: { list: null } } : unified(url));
  await assert.rejects(syncProvider("bitget", credentials), /25620/);
});

for (const data of [null, { list: {} }, "invalid"]) {
  test("unknown response types retain the snapshot and identify the failing category", async (t) => {
    mock(t, (url) => url.pathname.endsWith("/current-position") &&
      url.searchParams.get("category") === "USDC-FUTURES" ? ok(data) : unified(url));
    await assert.rejects(syncProvider("bitget", credentials), /UTA USDC-FUTURES.*data=.*list=/);
  });
}

for (const status of [200, 400]) {
  test(`Classic falls back only on explicit 25245 (HTTP ${status}) and retains v2 fields`, async (t) => {
    mock(t, (url) => {
      if (url.pathname === "/api/v3/account/assets") return new Response(
        JSON.stringify({ code: "25245", msg: "The account is not the unified account mode" }), { status });
      if (url.pathname === "/api/v2/spot/account/assets") return ok([{ coin: "USDT", available: "10" }]);
      if (url.pathname === "/api/v2/mix/account/accounts") return ok([{ marginCoin: "USDT", accountEquity: "100" }]);
      if (url.pathname === "/api/v2/mix/position/all-position") return ok([
        { ...position, holdSide: "short", openPriceAvg: "0.0324", unrealizedPL: "28" },
      ]);
      if (url.pathname === "/api/v2/spot/market/tickers") return ok([]);
    });
    const result = await syncProvider("bitget", credentials);
    assert.equal(result.accountNetUsd, 110);
    assert.equal(result.positions[0].side, "SHORT");
    assert.equal(result.positions[0].entryPriceUsd, 0.0324);
    assert.equal(result.positions[0].unrealizedPnlUsd, 28);
  });
}

for (const [name, response] of [
  ["permission", { code: "25620", msg: "permission denied" }],
  ["signature", { code: "40009", msg: "sign signature error" }],
  ["invalid JSON", new Response("<html>not JSON</html>")],
  ["WAF", new Response("<html>Forbidden</html>", { status: 403 })],
]) {
  test(`UTA ${name} failure never falls back to an empty Classic snapshot`, async (t) => {
    const calls = mock(t, () => response);
    await assert.rejects(syncProvider("bitget", credentials));
    assert.equal(calls.length, 1);
  });
}

for (const response of [
  { code: "25620", msg: "permission denied" },
  ok({}),
  ok({ list: [{}] }),
  ok({ list: [{ ...position, posSide: "unknown" }] }),
  ok({ list: [{ ...position, markPrice: "bad" }] }),
  new Response("", { status: 429 }),
]) {
  test("failed or malformed position query rejects the entire snapshot", async (t) => {
    mock(t, (url) => url.pathname.endsWith("/current-position") &&
      url.searchParams.get("category") === "USDC-FUTURES" ? response : unified(url));
    await assert.rejects(syncProvider("bitget", credentials));
  });
}

test("an explicit empty UTA position list is a successful closed-position snapshot", async (t) => {
  mock(t, (url) => url.pathname.endsWith("/current-position") ? ok({ list: [] }) : unified(url));
  const result = await syncProvider("bitget", credentials);
  assert.deepEqual(result.positions, []);
  assert.equal(result.accountNetUsd, 1025);
});

test("Classic position failure is not saved as zero positions", async (t) => {
  mock(t, (url) => {
    if (url.pathname.startsWith("/api/v3/")) return { code: "25245" };
    if (url.pathname.endsWith("/all-position")) return { code: "40014", msg: "permission denied" };
    return ok([]);
  });
  await assert.rejects(syncProvider("bitget", credentials), /40014/);
});

test("transport failure does not trigger Classic fallback", async (t) => {
  const calls = mock(t, () => { throw new TypeError("network failure"); });
  await assert.rejects(syncProvider("bitget", credentials), /network failure/);
  assert.equal(calls.length, 1);
});

test("malformed unified equity fails before positions can be persisted", async (t) => {
  const calls = mock(t, () => ok({ assets: [] }));
  await assert.rejects(syncProvider("bitget", credentials), /자산 응답/);
  assert.equal(calls.length, 1);
});
