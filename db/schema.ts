import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    publicSummary: text("public_summary").notNull().default(""),
    status: text("status").notNull().default("connected"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("connections_user_provider_unique").on(table.userId, table.provider),
    index("connections_user_idx").on(table.userId),
  ],
);

export const portfolioSnapshots = sqliteTable(
  "portfolio_snapshots",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    accountNetUsd: real("account_net_usd").notNull().default(0),
    externalFlowUsd: real("external_flow_usd").notNull().default(0),
    payloadJson: text("payload_json").notNull(),
    syncedAt: text("synced_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("snapshots_user_synced_idx").on(table.userId, table.syncedAt),
    index("snapshots_connection_synced_idx").on(table.connectionId, table.syncedAt),
  ],
);

export const costBasisOverrides = sqliteTable(
  "cost_basis_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    symbol: text("symbol").notNull(),
    averageEntryUsd: real("average_entry_usd").notNull(),
    note: text("note").notNull().default("Manual override"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("cost_basis_user_provider_symbol_unique").on(
      table.userId,
      table.provider,
      table.symbol,
    ),
    index("cost_basis_user_idx").on(table.userId),
  ],
);
