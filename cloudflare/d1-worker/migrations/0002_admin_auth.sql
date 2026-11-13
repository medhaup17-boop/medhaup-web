-- Opaque admin session tokens are hashed by the application before storage.
-- The historical Clerk admins table remains for migration compatibility only.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  credential_version TEXT NOT NULL CHECK (length(credential_version) = 64 AND credential_version NOT GLOB '*[^0-9a-f]*'),
  expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer' AND expires_at > 0)
);
CREATE INDEX admin_sessions_expiry_idx ON admin_sessions (expires_at);

CREATE TABLE admin_login_limits (
  key TEXT PRIMARY KEY NOT NULL CHECK (length(key) BETWEEN 1 AND 128 AND key NOT GLOB '*[^A-Za-z0-9:_-]*'),
  window_start INTEGER NOT NULL CHECK (typeof(window_start) = 'integer' AND window_start >= 0),
  attempts INTEGER NOT NULL CHECK (typeof(attempts) = 'integer' AND attempts BETWEEN 1 AND 1000)
);
CREATE INDEX admin_login_limits_window_idx ON admin_login_limits (window_start);
