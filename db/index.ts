import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { BOOTSTRAP_STATEMENTS } from "./bootstrap";
import * as schema from "./schema";

// Turso (libSQL) replaces the Cloudflare D1 binding the Sites build used. The
// schema is plain SQLite, so nothing else changes; tables are created on the
// first request each server instance handles.

type Db = LibSQLDatabase<typeof schema>;

let client: Client | null = null;
let db: Db | null = null;
let ready: Promise<void> | null = null;

function connectionConfig() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL이 설정되지 않았습니다. Vercel 프로젝트 환경변수에 Turso 데이터베이스 URL과 토큰을 추가해 주세요.",
    );
  }
  return { url, authToken: authToken || undefined };
}

export function getDb(): Db {
  if (!db) {
    client = createClient(connectionConfig());
    db = drizzle(client, { schema });
  }
  return db;
}

export async function ensureDatabase(): Promise<Db> {
  const instance = getDb();
  if (!ready) {
    ready = (async () => {
      for (const statement of BOOTSTRAP_STATEMENTS) {
        await client!.execute(statement);
      }
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
  return instance;
}
