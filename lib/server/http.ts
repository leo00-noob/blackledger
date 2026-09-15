const REQUEST_TIMEOUT_MS = 12_000;

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const record = parsed as Record<string, unknown> | null;
      const nested = record?.error as Record<string, unknown> | undefined;
      const detail =
        record?.msg ??
        record?.message ??
        nested?.message ??
        nested?.name ??
        `HTTP ${response.status}`;
      throw new ProviderError(String(detail), response.status);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderError("거래소 응답 시간이 초과되었습니다.", 504);
    }
    throw new ProviderError(
      error instanceof Error ? error.message : "거래소 연결에 실패했습니다.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function positive(value: unknown): number {
  return Math.max(0, numberValue(value));
}

export function cleanProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "연결에 실패했습니다.";
  return raw.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

