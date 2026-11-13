import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const loaded = new Map();
function load(relative) {
  const filename = resolve(root, relative);
  if (loaded.has(filename)) return loaded.get(filename);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", source)((name) => {
    if (name === "server-only") return {};
    if (name.startsWith(".")) return load(resolve(dirname(filename), name + ".ts"));
    return require(name);
  }, mod, mod.exports);
  loaded.set(filename, mod.exports);
  return mod.exports;
}

const store = load("lib/auth/store.ts");
const { default: worker } = load("cloudflare/d1-worker/src/index.ts");
const firstMigration = readFileSync(resolve(root, "cloudflare/d1-worker/migrations/0001_fresh_content.sql"), "utf8");
const authMigration = readFileSync(resolve(root, "cloudflare/d1-worker/migrations/0002_admin_auth.sql"), "utf8");
const SECRET = "test-only-auth-gateway-shared-secret-32";
const TOKEN = "a".repeat(64);
const VERSION = "b".repeat(64);
const OTHER_VERSION = "c".repeat(64);

function setup(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(firstMigration);
  db.prepare("INSERT INTO admins (clerk_user_id) VALUES (?)").run("user_legacy");
  db.exec(authMigration);
  let calls = 0;
  const env = {
    D1_GATEWAY_SECRET: SECRET,
    DB: {
      prepare(sql) { return { bind(...params) { return { sql, params }; } }; },
      async batch(statements) {
        calls++;
        db.exec("BEGIN");
        try {
          const results = statements.map(({ sql, params }) => ({
            success: true,
            results: db.prepare(sql).all(...params),
            meta: { changes: Number(db.prepare("SELECT changes() AS n").get().n) },
          }));
          db.exec("COMMIT");
          return results;
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      },
    },
  };
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.D1_GATEWAY_URL;
  const originalSecret = process.env.D1_GATEWAY_SECRET;
  process.env.D1_GATEWAY_URL = "https://auth-db.example.test/query";
  process.env.D1_GATEWAY_SECRET = SECRET;
  globalThis.fetch = async (url, options) => worker.fetch(new Request(url, options), env);
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.D1_GATEWAY_URL;
    else process.env.D1_GATEWAY_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.D1_GATEWAY_SECRET;
    else process.env.D1_GATEWAY_SECRET = originalSecret;
    db.close();
  });
  return { db, env, calls: () => calls };
}

test("auth migration preserves existing content schema and constrains persisted auth data", (t) => {
  const { db } = setup(t);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admins").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_sessions").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_login_limits").get().n, 0);
  const session = db.prepare("INSERT INTO admin_sessions (token_hash, credential_version, expires_at) VALUES (?, ?, ?)");
  assert.throws(() => session.run("raw-cookie-token", VERSION, 1000));
  assert.throws(() => session.run(TOKEN, "plain-password", 1000));
  assert.throws(() => session.run(TOKEN, VERSION, 1.5));
  assert.throws(() => session.run(TOKEN, VERSION, 0));
  const limiter = db.prepare("INSERT INTO admin_login_limits (key, window_start, attempts) VALUES (?, ?, ?)");
  assert.throws(() => limiter.run("ip:test", -1, 1));
  assert.throws(() => limiter.run("ip:test", 0, 0));
  assert.throws(() => limiter.run("ip:test", 0, 1001));
  assert.throws(() => limiter.run("ip:test", 0, 1.5));
  assert.throws(() => limiter.run("invalid key", 0, 1));
});

test("concurrent login reservations never exceed the fixed-window bound", async (t) => {
  const { db } = setup(t);
  // All requests overlap through the real gateway's asynchronous auth check.
  // SQLite serializes each atomic UPSERT without a read-before-write race.
  const reservations = await Promise.all(Array.from({ length: 50 }, () => store.consumeLoginAttempt("ip:test", 10, 900, 1000)));
  assert.equal(reservations.filter(Boolean).length, 10);
  assert.deepEqual({ ...db.prepare("SELECT * FROM admin_login_limits WHERE key = ?").get("ip:test") }, { key: "ip:test", window_start: 900, attempts: 10 });
  assert.equal(await store.consumeLoginAttempt("ip:other", 10, 900, 1000), true);
  assert.equal(await store.consumeLoginAttempt("ip:test", 10, 900, 1799.9), false);
  assert.equal(await store.consumeLoginAttempt("ip:test", 10, 900, 1800), true);
  assert.equal(await store.consumeLoginAttempt("ip:test", 10, 900, 1799), false, "a delayed old request must not reset the new window");
  assert.equal(db.prepare("SELECT attempts FROM admin_login_limits WHERE key = ?").get("ip:test").attempts, 1);
});

test("global and per-IP limits reserve independent counters and deny after exhaustion", async (t) => {
  const { db } = setup(t);
  for (let attempt = 0; attempt < 30; attempt++) {
    assert.equal(await store.consumeLoginAttempt("global:test", 30, 900, 1000), true);
    assert.equal(await store.consumeLoginAttempt("ip:test", 10, 900, 1000), attempt < 10);
  }
  assert.equal(await store.consumeLoginAttempt("global:test", 30, 900, 1000), false);
  assert.equal(db.prepare("SELECT attempts FROM admin_login_limits WHERE key = ?").get("ip:test").attempts, 10);
});

test("sessions require the current credential version, expire exactly, and revoke immediately", async (t) => {
  const { db } = setup(t);
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;
  assert.equal(await store.hasAdminSession(TOKEN, VERSION), false);
  await store.createAdminSession(TOKEN, VERSION, expiry);
  assert.deepEqual({ ...db.prepare("SELECT * FROM admin_sessions").get() }, { token_hash: TOKEN, credential_version: VERSION, expires_at: expiry });
  assert.equal(await store.hasAdminSession(TOKEN, VERSION, now), true);
  assert.equal(await store.hasAdminSession(TOKEN, OTHER_VERSION, now), false);
  assert.equal(await store.hasAdminSession("d".repeat(64), VERSION, now), false);
  assert.equal(await store.hasAdminSession(TOKEN, VERSION, expiry - 0.1), true);
  assert.equal(await store.hasAdminSession(TOKEN, VERSION, expiry), false);
  await store.deleteAdminSession(TOKEN);
  assert.equal(await store.hasAdminSession(TOKEN, VERSION, now), false);
  await store.deleteAdminSession(TOKEN);
});

test("session creation bounds cleanup and retains every potentially active limiter", async (t) => {
  const { db } = setup(t);
  const now = Math.floor(Date.now() / 1000);
  const insertSession = db.prepare("INSERT INTO admin_sessions (token_hash, credential_version, expires_at) VALUES (?, ?, ?)");
  const insertLimit = db.prepare("INSERT INTO admin_login_limits (key, window_start, attempts) VALUES (?, ?, ?)");
  for (let index = 0; index < 125; index++) {
    insertSession.run(index.toString(16).padStart(64, "0"), VERSION, now - 10);
    insertLimit.run(`old:${index}`, now - 172800, 10);
  }
  insertSession.run("d".repeat(64), VERSION, now + 3600);
  const activeWindow = Math.floor(now / 86400) * 86400;
  insertLimit.run("active:daily", activeWindow, 10);
  await store.createAdminSession(TOKEN, VERSION, now + 3600);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_sessions WHERE expires_at <= ?").get(now).n, 25);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_login_limits WHERE window_start < ?").get(now - 86400).n, 25);
  assert.equal(await store.hasAdminSession("d".repeat(64), VERSION, now), true);
  assert.equal(await store.consumeLoginAttempt("active:daily", 10, 86400, now), false);
});

test("invalid inputs cannot reach the database or authenticate", async (t) => {
  const { calls } = setup(t);
  for (const args of [
    ["ip:test' OR 1=1", 10, 900, 1000], ["ip:test", 0, 900, 1000],
    ["ip:test", 1001, 900, 1000], ["ip:test", 1.5, 900, 1000],
    ["ip:test", 10, 0, 1000], ["ip:test", 10, 86401, 1000],
    ["ip:test", 10, 900, -1], ["ip:test", 10, 900, NaN],
  ]) await assert.rejects(store.consumeLoginAttempt(...args), TypeError);
  const future = Math.floor(Date.now() / 1000) + 3600;
  await assert.rejects(store.createAdminSession("plaintext", VERSION, future), TypeError);
  await assert.rejects(store.createAdminSession(TOKEN, "plaintext", future), TypeError);
  await assert.rejects(store.createAdminSession(TOKEN, VERSION, 0), TypeError);
  await assert.rejects(store.deleteAdminSession("plaintext"), TypeError);
  assert.equal(await store.hasAdminSession("plaintext", VERSION), false);
  assert.equal(await store.hasAdminSession(TOKEN, "plaintext"), false);
  assert.equal(calls(), 0);
});

test("database outages fail closed for every authentication operation", async (t) => {
  const { env } = setup(t);
  env.DB.batch = async () => { throw new Error("private database failure"); };
  const unavailable = (error) => error.status === 503 && !error.message.includes("private");
  await assert.rejects(store.consumeLoginAttempt("ip:test", 10, 900), unavailable);
  await assert.rejects(store.createAdminSession(TOKEN, VERSION, Math.floor(Date.now() / 1000) + 3600), unavailable);
  await assert.rejects(store.hasAdminSession(TOKEN, VERSION), unavailable);
  await assert.rejects(store.deleteAdminSession(TOKEN), unavailable);
});

test("a duplicate token cannot replace an existing session or partially commit cleanup", async (t) => {
  const { db } = setup(t);
  const now = Math.floor(Date.now() / 1000);
  await store.createAdminSession(TOKEN, VERSION, now + 3600);
  db.prepare("INSERT INTO admin_sessions (token_hash, credential_version, expires_at) VALUES (?, ?, ?)").run("d".repeat(64), VERSION, now - 10);
  await assert.rejects(store.createAdminSession(TOKEN, OTHER_VERSION, now + 7200), (error) => error.status === 409);
  assert.equal(await store.hasAdminSession(TOKEN, VERSION, now), true);
  assert.equal(await store.hasAdminSession(TOKEN, OTHER_VERSION, now), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_sessions WHERE expires_at <= ?").get(now).n, 1, "the failed batch must roll back its cleanup");
});
