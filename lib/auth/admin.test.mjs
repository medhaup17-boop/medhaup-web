import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import * as password from "./password.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "https://admin.example.test";
const email = "admin@example.test";
const passphrase = "A long test-only admin passphrase!";
const secret = "a".repeat(43);
const passwordHash = await password.createPasswordHash(passphrase);
const compiled = new Map();

function createLoader(overrides, fileOverrides, environment) {
  const cache = new Map();
  function load(path) {
    const filename = resolve(root, path);
    if (fileOverrides.has(filename)) return fileOverrides.get(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    if (!compiled.has(filename)) {
      compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText);
    }
    new Function("require", "module", "exports", "process", compiled.get(filename))((name) => {
      if (name === "server-only") return {};
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith(".") || name.startsWith("@/")) {
        const base = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(filename), name);
        return load(/\.(?:ts|mjs)$/.test(base) ? base : `${base}.ts`);
      }
      return require(name);
    }, loadedModule, loadedModule.exports, { env: environment });
    return loadedModule.exports;
  }
  return load;
}

function harness(options = {}) {
  const env = {
    NODE_ENV: options.production ? "production" : "test",
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD_HASH: passwordHash,
    ADMIN_SESSION_SECRET: secret,
    ...options.env,
  };
  const events = [];
  const sessions = new Map();
  const limits = new Map();
  const browserCookies = new Map();
  const state = { now: Math.floor(Date.now() / 1000), fail: undefined, failure: undefined };
  class DatabaseError extends Error {
    constructor() { super("The content database is unavailable. Please try again."); this.status = 503; }
  }
  class StorageError extends Error {}
  class ValidationError extends Error {}
  function record(type, ...values) {
    events.push([type, ...values]);
    if (state.fail === type || state.fail === "all") throw state.failure ?? new DatabaseError();
  }
  const store = {
    async createAdminSession(tokenHash, credentialVersion, expiresAt) {
      record("create", tokenHash, credentialVersion, expiresAt);
      sessions.set(tokenHash, { credentialVersion, expiresAt });
    },
    async hasAdminSession(tokenHash, credentialVersion) {
      record("read", tokenHash, credentialVersion);
      const row = sessions.get(tokenHash);
      return Boolean(row && row.credentialVersion === credentialVersion && row.expiresAt > state.now);
    },
    async deleteAdminSession(tokenHash) {
      record("delete", tokenHash);
      sessions.delete(tokenHash);
    },
    async consumeLoginAttempt(key, limit, windowSeconds) {
      record("limit", key, limit, windowSeconds);
      const start = Math.floor(state.now / windowSeconds) * windowSeconds;
      let row = limits.get(key);
      if (!row || row.start < start) {
        row = { start, attempts: 0 };
        limits.set(key, row);
      }
      if (row.start !== start || row.attempts >= limit) return false;
      row.attempts++;
      return true;
    },
  };
  const headers = { cookies: async () => ({ get: (name) => browserCookies.has(name) ? { name, value: browserCookies.get(name) } : undefined }) };
  const overrides = {
    "next/headers": headers,
    "next/navigation": { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); } },
    "next/cache": { revalidateTag() {}, revalidatePath() {} },
    "@/lib/db/repository": { ValidationError },
    "@/lib/storage/validation": { StorageError },
    "@/lib/cloudflare/d1": { DatabaseError },
  };
  const fileOverrides = new Map([
    [resolve(root, "lib/auth/store.ts"), store],
    [resolve(root, "lib/auth/password.mjs"), {
      ...password,
      verifyPassword: async (...args) => { events.push(["password"]); return password.verifyPassword(...args); },
    }],
  ]);
  const load = createLoader(overrides, fileOverrides, env);
  const config = load("lib/auth/config.ts");
  const session = load("lib/auth/session.ts");
  const guard = load("lib/auth/admin.ts");
  return {
    env, events, sessions, limits, browserCookies, state, store, config, session, guard,
    login: load("app/api/admin/auth/login/route.ts"),
    logout: load("app/api/admin/auth/logout/route.ts"),
    setCookie(token) {
      if (token === undefined) browserCookies.delete(session.ADMIN_COOKIE_NAME);
      else browserCookies.set(session.ADMIN_COOKIE_NAME, token);
    },
    acceptCookie(response) {
      const cookie = response.cookies.get(session.ADMIN_COOKIE_NAME);
      assert.ok(cookie, "authentication response must set its session cookie");
      if (cookie.maxAge === 0) browserCookies.delete(cookie.name);
      else browserCookies.set(cookie.name, cookie.value);
      return cookie.value;
    },
  };
}

function request(path = "login", options = {}) {
  const headers = new Headers(options.headers);
  const suppliedOrigin = Object.hasOwn(options, "origin") ? options.origin : origin;
  if (suppliedOrigin !== null) headers.set("origin", suppliedOrigin);
  const body = Object.hasOwn(options, "body") ? options.body : path === "login" ? { email, password: passphrase } : undefined;
  if (body !== undefined) {
    const contentType = Object.hasOwn(options, "contentType") ? options.contentType : "application/json";
    if (contentType !== null) headers.set("content-type", contentType);
  }
  return new Request(`${origin}/api/admin/auth/${path}`, {
    method: "POST", headers,
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

async function signIn(h, options) {
  const response = await h.login.POST(request("login", options));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(), { ok: true });
  return { response, token: h.acceptCookie(response) };
}

test("password hashes use unique salts, preserve the exact password, and reject invalid hashes", async () => {
  const second = await password.createPasswordHash(passphrase);
  assert.notEqual(passwordHash, second);
  assert.notEqual(passwordHash.split(":")[4], second.split(":")[4]);
  assert.match(passwordHash, /^scrypt:32768:8:3:/);
  assert.equal(await password.verifyPassword(passphrase, passwordHash), true);
  assert.equal(await password.verifyPassword(`${passphrase} `, passwordHash), false);
  for (const malformed of ["", "plaintext", passwordHash.slice(0, -1), passwordHash.replace("32768", "999999999"), "scrypt:32768:8:3:" + "z".repeat(32) + ":" + "0".repeat(128)]) {
    assert.equal(password.isPasswordHash(malformed), false);
    assert.equal(await password.verifyPassword(passphrase, malformed), false);
  }
  assert.equal(password.isPasswordHash(null), false);
  assert.equal(await password.verifyPassword("x".repeat(1025), passwordHash), false);
  await assert.rejects(password.createPasswordHash("short"));
  await assert.rejects(password.createPasswordHash("x".repeat(14)));
  await assert.rejects(password.createPasswordHash("é".repeat(513)));
});

test("configuration normalizes email and fails closed for missing or malformed credentials", () => {
  const valid = harness({ env: { ADMIN_EMAIL: " ADMIN@EXAMPLE.TEST " } });
  assert.equal(valid.config.getAdminAuthConfig().email, email);
  for (const env of [
    { ADMIN_EMAIL: "" }, { ADMIN_EMAIL: "not-an-email" }, { ADMIN_EMAIL: "a".repeat(255) },
    { ADMIN_PASSWORD_HASH: "" }, { ADMIN_PASSWORD_HASH: "plaintext" },
    { ADMIN_SESSION_SECRET: "" }, { ADMIN_SESSION_SECRET: "short" }, { ADMIN_SESSION_SECRET: "!".repeat(43) },
  ]) {
    const h = harness({ env });
    assert.equal(h.config.getAdminAuthConfig(), null);
    assert.equal(h.config.isAdminAuthConfigured(), false);
  }
});

test("login and logout reject missing, cross-origin, null, or lookalike origins before persistence", async () => {
  for (const suppliedOrigin of [null, "null", "https://evil.example", `${origin}.evil.example`, "http://admin.example.test"]) {
    for (const route of ["login", "logout"]) {
      const h = harness();
      h.setCookie("a".repeat(43));
      const response = await h[route].POST(request(route, { origin: suppliedOrigin }));
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(h.events, []);
    }
  }
});

test("login enforces JSON object bodies, payload byte limits, and bounded credentials before work", async () => {
  for (const [options, status] of [
    [{ contentType: "text/plain" }, 415], [{ contentType: null }, 415],
    [{ body: undefined }, 415], [{ body: undefined, headers: { "content-type": "application/json" } }, 400],
    [{ body: "{" }, 400], [{ body: null }, 400], [{ body: [] }, 400],
    [{ body: {} }, 400], [{ body: { email, password: "" } }, 400],
    [{ body: { email: 123, password: passphrase } }, 400],
    [{ body: { email: "a".repeat(255), password: passphrase } }, 400],
    [{ body: { email, password: "é".repeat(513) } }, 400],
    [{ body: { email, password: passphrase, padding: "é".repeat(2100) } }, 413],
  ]) {
    const h = harness();
    const response = await h.login.POST(request("login", options));
    assert.equal(response.status, status, JSON.stringify(options));
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(h.events, []);
  }
});

test("incorrect email and password return the same safe response and both verify the password", async () => {
  const bodies = [];
  for (const body of [{ email: "someone@example.test", password: passphrase }, { email, password: "incorrect password" }]) {
    const h = harness();
    const response = await h.login.POST(request("login", { body }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    bodies.push(await response.json());
    assert.equal(h.events.filter(([kind]) => kind === "password").length, 1);
    assert.equal(h.sessions.size, 0);
  }
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[0], { error: "Incorrect email or password." });
});

test("valid login emits an eight-hour HttpOnly host-only session and stores only token digests", async () => {
  const h = harness();
  const before = Math.floor(Date.now() / 1000);
  const { response, token } = await signIn(h, { body: { email: " ADMIN@EXAMPLE.TEST ", password: passphrase } });
  const header = response.headers.get("set-cookie");
  assert.match(header, /^medhaup_admin_session=/);
  assert.match(header, /; Path=\//);
  assert.match(header, /; Max-Age=28800/);
  assert.match(header, /; HttpOnly/);
  assert.match(header, /; SameSite=lax/i);
  assert.doesNotMatch(header, /; (?:Secure|Domain=)/);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(h.sessions.size, 1);
  const [[storedHash, row]] = h.sessions.entries();
  assert.match(storedHash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedHash, token);
  assert.match(row.credentialVersion, /^[a-f0-9]{64}$/);
  assert.ok(row.expiresAt >= before + 28800 && row.expiresAt <= Math.floor(Date.now() / 1000) + 28800);
  assert.ok(!JSON.stringify([...h.sessions, ...h.events]).includes(token));
  assert.deepEqual(await h.guard.requireAdmin(), { userId: "single-admin" });
  assert.deepEqual(await h.guard.requireAdminPage(), { userId: "single-admin" });
});

test("production sets and clears a Secure __Host cookie with matching scope", async () => {
  const h = harness({ production: true });
  const { response } = await signIn(h);
  const header = response.headers.get("set-cookie");
  assert.match(header, /^__Host-medhaup_admin_session=/);
  assert.match(header, /; Secure/);
  assert.match(header, /; HttpOnly/);
  assert.match(header, /; Path=\//);
  assert.doesNotMatch(header, /; Domain=/);
  const logout = await h.logout.POST(request("logout"));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /^__Host-medhaup_admin_session=;/);
  assert.match(logout.headers.get("set-cookie"), /; Max-Age=0/);
  assert.match(logout.headers.get("set-cookie"), /; Secure/);
});

test("tampered, malformed, unknown, and expired session tokens never authorize", async () => {
  const h = harness();
  const { token } = await signIn(h);
  for (const invalid of ["", "short", "!".repeat(43), "a".repeat(43), `${token[0] === "a" ? "b" : "a"}${token.slice(1)}`]) {
    h.setCookie(invalid);
    assert.equal(await h.session.verifyAdminSession(invalid), false);
    await assert.rejects(h.guard.requireAdmin(), { status: 401 });
  }
  h.setCookie(token);
  h.state.now = [...h.sessions.values()][0].expiresAt;
  assert.equal(await h.session.verifyAdminSession(token), false);
  await assert.rejects(h.guard.requireAdmin(), { status: 401 });
});

test("changing email, password hash, or session secret revokes previously issued sessions", async () => {
  const replacementHash = await password.createPasswordHash("A replacement test-only password!");
  for (const [key, value] of [
    ["ADMIN_EMAIL", "replacement@example.test"],
    ["ADMIN_PASSWORD_HASH", replacementHash],
    ["ADMIN_SESSION_SECRET", "b".repeat(43)],
  ]) {
    const h = harness();
    const { token } = await signIn(h);
    assert.deepEqual(await h.guard.requireAdmin(), { userId: "single-admin" });
    h.env[key] = value;
    assert.equal(await h.session.verifyAdminSession(token), false, key);
    await assert.rejects(h.guard.requireAdmin(), { status: 401 });
  }
});

test("logout revokes the server record, so a copied cookie cannot be replayed", async () => {
  const h = harness();
  const { token } = await signIn(h);
  assert.deepEqual(await h.guard.requireAdmin(), { userId: "single-admin" });
  const response = await h.logout.POST(request("logout"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(h.sessions.size, 0);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  h.setCookie(token);
  assert.equal(await h.session.verifyAdminSession(token), false);
  await assert.rejects(h.guard.requireAdmin(), { status: 401 });
});

test("successful re-login replaces and revokes the preceding browser token", async () => {
  const h = harness();
  const first = await signIn(h);
  const second = await signIn(h);
  assert.notEqual(first.token, second.token);
  assert.equal(await h.session.verifyAdminSession(first.token), false);
  assert.equal(await h.session.verifyAdminSession(second.token), true);
  assert.equal(h.sessions.size, 1);
});

test("a failed sign-in does not revoke an existing valid browser session", async () => {
  const h = harness();
  const { token } = await signIn(h);
  const response = await h.login.POST(request("login", { body: { email, password: "wrong password" } }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await h.session.verifyAdminSession(token), true);
  assert.equal(h.events.filter(([kind]) => kind === "delete").length, 0);
});

test("session persistence failures deny access and login never emits an unrecorded token", async () => {
  for (const fail of ["limit", "create"]) {
    const h = harness();
    h.state.fail = fail;
    const response = await h.login.POST(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(h.sessions.size, 0);
  }
  const h = harness();
  await signIn(h);
  h.state.fail = "read";
  h.state.failure = new Error("private database host and secret");
  await assert.rejects(h.guard.requireAdmin(), (error) => error.status === 503 && !error.message.includes("private"));
  await assert.rejects(h.guard.requireAdminPage(), { status: 503 });
});

test("failed server-side logout never reports success or clears a still-valid browser cookie", async () => {
  const h = harness();
  const { token } = await signIn(h);
  h.state.fail = "delete";
  const response = await h.logout.POST(request("logout"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(h.sessions.size, 1);
  assert.equal(h.browserCookies.get(h.session.ADMIN_COOKIE_NAME), token);
  h.state.fail = undefined;
  assert.equal(await h.session.verifyAdminSession(token), true);
});

test("unexpected persistence errors produce a safe response with no authentication cookie", async (t) => {
  const h = harness();
  h.state.fail = "create";
  h.state.failure = new Error("private database URL and secret password");
  const logged = t.mock.method(console, "error", () => undefined);
  const response = await h.login.POST(request());
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.doesNotMatch(JSON.stringify(body), /private|secret|password/);
  assert.ok(logged.mock.calls.every(({ arguments: args }) => !JSON.stringify(args).includes("secret")));
});

test("missing configuration and anonymous sessions fail closed, with page-only sign-in redirects", async () => {
  const missing = harness({ env: { ADMIN_SESSION_SECRET: "" } });
  assert.equal((await missing.login.POST(request())).status, 503);
  await assert.rejects(missing.guard.requireAdmin(), { status: 503 });
  await assert.rejects(missing.guard.requireAdminPage(), { status: 503 });
  assert.deepEqual(missing.events, []);
  const h = harness();
  await assert.rejects(h.guard.requireAdmin(), { status: 401 });
  await assert.rejects(h.guard.requireAdminPage(), { url: "/admin/login" });
  assert.deepEqual(h.events, []);
  const logout = await h.logout.POST(request("logout"));
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.deepEqual(h.events, []);
});

test("per-IP limits return 429 and Retry-After before hashing a password", async () => {
  const h = harness();
  const ip = "192.0.2.1";
  const key = h.session.authDigest(h.config.getAdminAuthConfig(), "login-limit", `ip:${ip}`);
  h.limits.set(key, { start: Math.floor(h.state.now / 900) * 900, attempts: 10 });
  const response = await h.login.POST(request("login", { headers: { "x-vercel-forwarded-for": ip } }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "900");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(!h.events.some(([kind]) => kind === "password" || kind === "create"));
});

test("spoofing IP headers cannot bypass the global limit or grow limiter keys after exhaustion", async () => {
  const h = harness();
  const globalKey = h.session.authDigest(h.config.getAdminAuthConfig(), "login-limit", "global");
  h.limits.set(globalKey, { start: Math.floor(h.state.now / 900) * 900, attempts: 29 });
  const last = await h.login.POST(request("login", { body: { email, password: "wrong password" }, headers: { "x-vercel-forwarded-for": "192.0.2.1" } }));
  assert.equal(last.status, 401);
  const keyCount = h.limits.size;
  const passwordChecks = h.events.filter(([kind]) => kind === "password").length;
  for (const headers of [
    { "x-vercel-forwarded-for": "192.0.2.2" },
    { "x-vercel-forwarded-for": "2001:db8::1" },
    { "x-forwarded-for": "203.0.113.1, 203.0.113.2" },
    { "x-vercel-forwarded-for": "not-an-ip" }, {},
  ]) {
    const response = await h.login.POST(request("login", { headers }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "900");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(h.limits.size, keyCount);
  assert.equal(h.limits.get(globalKey).attempts, 30);
  assert.equal(h.events.filter(([kind]) => kind === "password").length, passwordChecks);
  h.state.now += 900;
  assert.equal((await h.login.POST(request())).status, 200);
});
