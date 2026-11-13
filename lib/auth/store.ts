import "server-only";
import { d1Batch, d1Query } from "../cloudflare/d1";

const HASH = /^[a-f0-9]{64}$/;
const LIMIT_KEY = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_WINDOW_SECONDS = 86_400;
const CLEANUP_LIMIT = 100;

function seconds(value: number): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.floor(value))) {
    throw new TypeError("Invalid authentication timestamp.");
  }
  return Math.floor(value);
}

function requireHash(value: string): void {
  if (typeof value !== "string" || !HASH.test(value)) throw new TypeError("Invalid authentication hash.");
}

/** Reserve an attempt atomically; rejected attempts do not increase the counter. */
export async function consumeLoginAttempt(
  key: string,
  limit: number,
  windowSeconds: number,
  nowSeconds = Date.now() / 1000,
): Promise<boolean> {
  if (typeof key !== "string" || !LIMIT_KEY.test(key)) throw new TypeError("Invalid login limit key.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("Invalid login attempt limit.");
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > MAX_WINDOW_SECONDS) {
    throw new TypeError("Invalid login attempt window.");
  }
  const now = seconds(nowSeconds);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  // A single SQLite write prevents simultaneous requests from oversubscribing
  // the window. A delayed request from an older window cannot reset its count.
  const rows = await d1Query(
    `INSERT INTO admin_login_limits (key, window_start, attempts) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       attempts = CASE WHEN admin_login_limits.window_start < excluded.window_start THEN 1 ELSE admin_login_limits.attempts + 1 END,
       window_start = excluded.window_start
     WHERE admin_login_limits.window_start < excluded.window_start
       OR (admin_login_limits.window_start = excluded.window_start AND admin_login_limits.attempts < ?)
     RETURNING attempts`,
    [key, windowStart, limit],
  );
  return rows.length === 1;
}

/** Store only a digest of the random browser token, never the token itself. */
export async function createAdminSession(tokenHash: string, credentialVersion: string, expiresAt: number): Promise<void> {
  requireHash(tokenHash);
  requireHash(credentialVersion);
  const now = seconds(Date.now() / 1000);
  const expiry = seconds(expiresAt);
  if (expiry <= now) throw new TypeError("The admin session must expire in the future.");
  // Bound cleanup work and retain every possible active limiter window. Expiry
  // and revocation checks never depend on these physical deletions completing.
  await d1Batch([
    {
      sql: "DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)",
      params: [now, CLEANUP_LIMIT],
    },
    {
      sql: "DELETE FROM admin_login_limits WHERE key IN (SELECT key FROM admin_login_limits WHERE window_start < ? ORDER BY window_start LIMIT ?)",
      params: [now - MAX_WINDOW_SECONDS, CLEANUP_LIMIT],
    },
    {
      sql: "INSERT INTO admin_sessions (token_hash, credential_version, expires_at) VALUES (?, ?, ?)",
      params: [tokenHash, credentialVersion, expiry],
    },
  ]);
}

/** Uncached, fail-closed session lookup; provider failures propagate to callers. */
export async function hasAdminSession(tokenHash: string, credentialVersion: string, nowSeconds = Date.now() / 1000): Promise<boolean> {
  if (typeof tokenHash !== "string" || !HASH.test(tokenHash) || typeof credentialVersion !== "string" || !HASH.test(credentialVersion)) return false;
  const now = seconds(nowSeconds);
  const rows = await d1Query(
    "SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND credential_version = ? AND expires_at > ? LIMIT ?",
    [tokenHash, credentialVersion, now, 1],
  );
  return rows.length === 1;
}

export async function deleteAdminSession(tokenHash: string): Promise<void> {
  requireHash(tokenHash);
  await d1Query("DELETE FROM admin_sessions WHERE token_hash = ?", [tokenHash]);
}
