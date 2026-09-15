// Idempotent schema bootstrap, mirroring drizzle/0000_closed_frog_thor.sql.
// It is embedded in code (instead of read from ./drizzle at runtime) so the
// serverless bundle on Vercel never depends on file tracing. New migrations
// should be appended here as further IF NOT EXISTS / ALTER statements.
export const BOOTSTRAP_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS connections (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    label text NOT NULL,
    encrypted_credentials text NOT NULL,
    public_summary text DEFAULT '' NOT NULL,
    status text DEFAULT 'connected' NOT NULL,
    last_synced_at text,
    last_error text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS connections_user_provider_unique ON connections (user_id, provider)`,
  `CREATE INDEX IF NOT EXISTS connections_user_idx ON connections (user_id)`,
  `CREATE TABLE IF NOT EXISTS cost_basis_overrides (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    symbol text NOT NULL,
    average_entry_usd real NOT NULL,
    note text DEFAULT 'Manual override' NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cost_basis_user_provider_symbol_unique ON cost_basis_overrides (user_id, provider, symbol)`,
  `CREATE INDEX IF NOT EXISTS cost_basis_user_idx ON cost_basis_overrides (user_id)`,
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id text PRIMARY KEY NOT NULL,
    connection_id text NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    account_net_usd real DEFAULT 0 NOT NULL,
    external_flow_usd real DEFAULT 0 NOT NULL,
    payload_json text NOT NULL,
    synced_at text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE INDEX IF NOT EXISTS snapshots_user_synced_idx ON portfolio_snapshots (user_id, synced_at)`,
  `CREATE INDEX IF NOT EXISTS snapshots_connection_synced_idx ON portfolio_snapshots (connection_id, synced_at)`,
];
