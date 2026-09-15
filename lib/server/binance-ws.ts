import { BINANCE_FUTURES_WS_API, BINANCE_USER_AGENT } from "@/lib/server/binance-endpoints";
import { hmac } from "@/lib/server/crypto";
import { ProviderError } from "@/lib/server/http";

// Binance fronts fapi.binance.com with CloudFront, which rejects requests from
// Cloudflare's egress ranges with HTTP 403 before they reach Binance. The
// USDⓈ-M WebSocket API (ws-fapi.binance.com) exposes the same USER_DATA
// methods, accepts HMAC signatures, and is served directly from Binance's own
// load balancers, so it works from a Worker when the REST hosts do not.

const WS_TIMEOUT_MS = 12_000;
const RECV_WINDOW = 7_000;

type WsParams = Record<string, string | number>;

type WsRequest = { method: string; params?: WsParams };

type WsResponse = {
  id?: string;
  status?: number;
  result?: unknown;
  error?: { code?: number; msg?: string };
};

type SocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "open", listener: () => void): void;
};

function isWorkersRuntime(): boolean {
  const agent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  return agent === "Cloudflare-Workers";
}

async function openSocket(url: string): Promise<SocketLike> {
  if (isWorkersRuntime()) {
    // Workers open outbound WebSockets through fetch() with an Upgrade header.
    const response = await fetch(url.replace(/^wss:/, "https:"), {
      headers: { Upgrade: "websocket", "User-Agent": BINANCE_USER_AGENT },
    });
    const socket = (response as Response & { webSocket?: SocketLike & { accept(): void } })
      .webSocket;
    if (!socket) {
      throw new ProviderError(
        `Binance 선물 WebSocket API 연결에 실패했습니다 (HTTP ${response.status}).`,
        response.status === 403 || response.status === 451 ? response.status : 502,
      );
    }
    socket.accept();
    return socket;
  }

  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => SocketLike & { readyState: number } })
    .WebSocket;
  if (!WebSocketCtor) {
    throw new ProviderError("이 런타임은 WebSocket 클라이언트를 지원하지 않습니다.");
  }
  const socket = new WebSocketCtor(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () =>
      reject(new ProviderError("Binance 선물 WebSocket API 연결에 실패했습니다.")),
    );
    socket.addEventListener("close", (event) =>
      reject(
        new ProviderError(
          `Binance 선물 WebSocket API 연결이 종료되었습니다${event.reason ? `: ${event.reason}` : ""}.`,
        ),
      ),
    );
  });
  return socket;
}

async function signedParams(
  apiKey: string,
  secretKey: string,
  params: WsParams,
): Promise<WsParams> {
  const unsigned: WsParams = {
    ...params,
    apiKey,
    timestamp: Date.now(),
    recvWindow: RECV_WINDOW,
  };
  // Binance signs the alphabetically sorted key=value pairs joined by "&".
  const payload = Object.keys(unsigned)
    .sort()
    .map((key) => `${key}=${unsigned[key]}`)
    .join("&");
  const signature = (await hmac(secretKey, payload, "hex")) as string;
  return { ...unsigned, signature };
}

function responseError(response: WsResponse): ProviderError {
  const status = response.status ?? 502;
  const detail = response.error?.msg ?? `HTTP ${status}`;
  return new ProviderError(String(detail), status >= 400 && status < 600 ? status : 502);
}

/**
 * Opens a single WebSocket API session, sends every request signed with the
 * user's HMAC key, and resolves with the results in the same order. Requests
 * are settled independently so one failing method does not discard the rest.
 */
export async function binanceFuturesWsRequests(
  credentials: { apiKey: string; secretKey: string },
  requests: WsRequest[],
  url: string = BINANCE_FUTURES_WS_API,
): Promise<PromiseSettledResult<unknown>[]> {
  const socket = await openSocket(url);
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const settleAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  const timer = setTimeout(() => {
    settleAll(new ProviderError("거래소 응답 시간이 초과되었습니다.", 504));
    try {
      socket.close(1000, "timeout");
    } catch {
      // The socket may already be closed.
    }
  }, WS_TIMEOUT_MS);

  socket.addEventListener("message", (event) => {
    let parsed: WsResponse;
    try {
      parsed = JSON.parse(String(event.data)) as WsResponse;
    } catch {
      return;
    }
    const id = parsed.id != null ? String(parsed.id) : "";
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (parsed.status === 200) {
      entry.resolve(parsed.result);
    } else {
      entry.reject(responseError(parsed));
    }
  });
  socket.addEventListener("close", (event) => {
    settleAll(
      new ProviderError(
        `Binance 선물 WebSocket API 연결이 종료되었습니다${event.reason ? `: ${event.reason}` : ""}.`,
      ),
    );
  });
  socket.addEventListener("error", () => {
    settleAll(new ProviderError("Binance 선물 WebSocket API 연결에 실패했습니다."));
  });

  try {
    const results = await Promise.allSettled(
      requests.map(async (request, index) => {
        const id = `${Date.now().toString(36)}-${index}`;
        const params = await signedParams(
          credentials.apiKey,
          credentials.secretKey,
          request.params ?? {},
        );
        const settled = new Promise<unknown>((resolve, reject) => {
          pending.set(id, { resolve, reject });
        });
        socket.send(JSON.stringify({ id, method: request.method, params }));
        return settled;
      }),
    );
    return results;
  } finally {
    clearTimeout(timer);
    try {
      socket.close(1000, "done");
    } catch {
      // Ignore close failures on an already-closed socket.
    }
  }
}
