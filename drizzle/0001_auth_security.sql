CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY NOT NULL, expires_at integer NOT NULL, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS login_failures (key text PRIMARY KEY NOT NULL, window_start integer NOT NULL, count integer NOT NULL);
