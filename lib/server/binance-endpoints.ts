import { ProviderError } from "@/lib/server/http";

// Binance documents these as interchangeable Spot REST API endpoints. Keep the
// list deliberately short so a WAF failure cannot fan out into excessive
// retries from a shared serverless egress IP.
export const BINANCE_SPOT_API_BASES = [
  "https://api-gcp.binance.com",
  "https://api1.binance.com",
  "https://api.binance.com",
] as const;

export const BINANCE_MARKET_DATA_BASE = "https://data-api.binance.vision";

// Binance documents fapi.binance.com as the primary USDⓈ-M endpoint. The
// numbered Binance-owned mirrors are attempted only after an upstream/WAF
// failure so a healthy primary request always stays on the documented host.
export const BINANCE_FUTURES_API_BASES = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
] as const;

// The USDⓈ-M WebSocket API serves the same USER_DATA methods as fapi but is
// not behind the CloudFront distribution that rejects Cloudflare egress IPs.
export const BINANCE_FUTURES_WS_API = "wss://ws-fapi.binance.com/ws-fapi/v1";

// Binance identifies clients partly by User-Agent; Workers send none, which
// some of its edge rules treat as bot traffic.
export const BINANCE_USER_AGENT = "BlackLedger/1.0 (personal portfolio dashboard)";

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

// Optional fixed-IP relay for the futures REST API (see relay/README.md).
// When BINANCE_FUTURES_RELAY_URL is set, it is tried before the Binance hosts
// so a dashboard on a blocked egress range still reaches fapi.binance.com.
export function binanceFuturesRelay(): { base: string; token: string } | null {
  const base = readEnv("BINANCE_FUTURES_RELAY_URL").replace(/\/+$/, "");
  if (!base) return null;
  return { base, token: readEnv("BINANCE_RELAY_TOKEN") };
}

export function binanceRequestHeaders(base: string): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": BINANCE_USER_AGENT };
  const relay = binanceFuturesRelay();
  if (relay && base === relay.base && relay.token) {
    headers["X-Relay-Token"] = relay.token;
  }
  return headers;
}

export function binanceFuturesBases(): string[] {
  const relay = binanceFuturesRelay();
  return relay ? [relay.base, ...BINANCE_FUTURES_API_BASES] : [...BINANCE_FUTURES_API_BASES];
}

const RETRYABLE_HOST_STATUSES = new Set([403, 404, 408, 451, 500, 502, 503, 504]);

function canTryAnotherHost(error: unknown): error is ProviderError {
  return (
    error instanceof ProviderError &&
    RETRYABLE_HOST_STATUSES.has(error.status)
  );
}

// True when the failure is about reaching Binance (WAF, geo block, outage,
// timeout) rather than about the API key itself, i.e. when a different
// transport to the same account is worth trying.
export function isBinanceHostError(error: unknown): boolean {
  return canTryAnotherHost(error);
}

function finalBinanceHostError(
  errors: ProviderError[],
  surface: "현물" | "선물",
): ProviderError {
  if (errors.some((error) => error.status === 403)) {
    return new ProviderError(
      `Binance ${surface} API가 이 대시보드 서버의 요청을 보안 방화벽(WAF)에서 차단했습니다. API 읽기 권한 오류가 아닙니다. 잠시 뒤 다시 시도해 주세요. 반복되면 고정 IP 중계 연결이 필요합니다.`,
      502,
    );
  }
  if (errors.some((error) => error.status === 451)) {
    return new ProviderError(
      "Binance API가 현재 서버 위치의 요청을 제한했습니다. 고정 IP 중계 연결이 필요합니다.",
      502,
    );
  }
  return errors.at(-1) ?? new ProviderError("Binance API에 연결하지 못했습니다.");
}

export async function withBinanceSpotFailover<T>(
  request: (base: (typeof BINANCE_SPOT_API_BASES)[number]) => Promise<T>,
): Promise<T> {
  const retryableErrors: ProviderError[] = [];

  for (const base of BINANCE_SPOT_API_BASES) {
    try {
      return await request(base);
    } catch (error) {
      if (!canTryAnotherHost(error)) throw error;
      retryableErrors.push(error);
    }
  }

  throw finalBinanceHostError(retryableErrors, "현물");
}

export async function withBinanceFuturesFailover<T>(
  request: (base: string) => Promise<T>,
): Promise<T> {
  const retryableErrors: ProviderError[] = [];

  for (const base of binanceFuturesBases()) {
    try {
      return await request(base);
    } catch (error) {
      if (!canTryAnotherHost(error)) throw error;
      retryableErrors.push(error);
    }
  }

  throw finalBinanceHostError(retryableErrors, "선물");
}
