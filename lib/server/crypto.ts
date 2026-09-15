const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export function utf8Base64Url(value: string): string {
  return base64Url(encoder.encode(value));
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return base64ToBytes(normalized + padding);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function encryptionKey(): Promise<CryptoKey> {
  const binding = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!binding) {
    throw new Error("서버 암호화 키가 설정되지 않았습니다.");
  }

  const raw = decodeBase64Url(binding);
  if (raw.byteLength !== 32) {
    throw new Error("서버 암호화 키 형식이 올바르지 않습니다.");
  }
  return crypto.subtle.importKey("raw", arrayBuffer(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptJson(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBuffer(iv) },
    await encryptionKey(),
    arrayBuffer(encoder.encode(JSON.stringify(value))),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptJson<T>(value: string): Promise<T> {
  const [version, encodedIv, encodedPayload] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedPayload) {
    throw new Error("저장된 연결 정보 형식이 올바르지 않습니다.");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(decodeBase64Url(encodedIv)) },
    await encryptionKey(),
    arrayBuffer(decodeBase64Url(encodedPayload)),
  );
  return JSON.parse(decoder.decode(decrypted)) as T;
}

export async function hmac(
  secret: string,
  value: string,
  output: "hex" | "base64" | "bytes" = "hex",
): Promise<string | Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, arrayBuffer(encoder.encode(value))),
  );
  if (output === "bytes") return signed;
  if (output === "base64") return bytesToBase64(signed);
  return Array.from(signed, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha512Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-512", arrayBuffer(encoder.encode(value))),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function jwtHs256(
  payload: Record<string, string | number>,
  secret: string,
): Promise<string> {
  const header = utf8Base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = utf8Base64Url(JSON.stringify(payload));
  const signature = (await hmac(secret, `${header}.${body}`, "bytes")) as Uint8Array;
  return `${header}.${body}.${base64Url(signature)}`;
}
