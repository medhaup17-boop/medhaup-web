import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const SECRET = "private-test-gateway-secret-never-log-this";
const ENDPOINT = "https://private-gateway.example.test/query";
const QUERY = [{ sql: "SELECT private_column FROM private_table LIMIT ?", params: [1] }];
const RESPONSE = { results: [{ results: [{ id: "record" }], meta: { changes: 0 } }] };
const GENERIC = "The content database is unavailable. Please try again.";
const code = ts.transpileModule(readFileSync(new URL("./d1.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(overrides = {}) {
  const logs = [];
  const calls = [];
  const env = { NODE_ENV: "production", D1_GATEWAY_URL: ENDPOINT, D1_GATEWAY_SECRET: SECRET, ...overrides.env };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "console", "fetch", code)(
    () => ({}), loaded, loaded.exports, { env }, { error: (...args) => logs.push(args) },
    async (...args) => { calls.push(args); return overrides.fetch ? overrides.fetch(...args) : Response.json(RESPONSE); },
  );
  return { ...loaded.exports, logs, calls };
}

async function rejectsSafely(h, reason, httpStatus) {
  const error = await h.d1Batch(QUERY).catch(error => error);
  assert.ok(error instanceof h.DatabaseError);
  assert.equal(error.status, 503);
  assert.equal(error.message, GENERIC);
  assert.equal(h.logs.length, 1, "one diagnostic per failed query");
  assert.equal(h.logs[0][0], `[d1] ${reason}`);
  if (httpStatus !== undefined) assert.equal(h.logs[0][1].httpStatus, httpStatus);
  const emitted = JSON.stringify({ logs: h.logs, message: error.message, error });
  for (const value of [SECRET, ENDPOINT, "private_column", "private_table", "provider-sensitive-body", "private-network-message"])
    assert.ok(!emitted.includes(value), `must not expose ${value}`);
  return error;
}

test("configuration failures identify the missing variable or invalid value without fetching", async () => {
  for (const [env, reason] of [
    [{ D1_GATEWAY_URL: undefined }, "missing_gateway_url"],
    [{ D1_GATEWAY_URL: " \n " }, "missing_gateway_url"],
    [{ D1_GATEWAY_SECRET: undefined }, "missing_gateway_secret"],
    [{ D1_GATEWAY_SECRET: "short" }, "invalid_gateway_secret"],
    [{ D1_GATEWAY_SECRET: SECRET + "\n" }, "invalid_gateway_secret"],
    [{ D1_GATEWAY_URL: `"${ENDPOINT}"` }, "invalid_gateway_url"],
    [{ D1_GATEWAY_URL: "http://127.0.0.1:8787/query" }, "invalid_gateway_url"],
    [{ D1_GATEWAY_URL: ENDPOINT + "?secret=provider-sensitive-body" }, "invalid_gateway_url"],
    [{ D1_GATEWAY_URL: "https://private-user:private-password@example.test/query" }, "invalid_gateway_url"],
  ]) {
    const h = setup({ env });
    await rejectsSafely(h, reason);
    assert.equal(h.calls.length, 0);
  }
});

test("gateway status diagnostics distinguish auth, endpoint, request, and service failures", async () => {
  for (const [status, reason] of [
    [401, "gateway_unauthorized"], [403, "gateway_unauthorized"],
    [404, "gateway_endpoint_not_found"], [400, "gateway_request_rejected"],
    [413, "gateway_request_rejected"], [415, "gateway_request_rejected"],
    [503, "gateway_unavailable"], [502, "gateway_unavailable"], [429, "gateway_http_error"],
  ]) {
    const h = setup({ fetch: () => new Response("provider-sensitive-body", { status }) });
    await rejectsSafely(h, reason, status);
  }
});

test("malformed and invalid gateway payloads are reported without logging their contents", async () => {
  for (const response of [
    () => new Response("provider-sensitive-body", { status: 200 }),
    () => Response.json({ token: SECRET }),
    () => Response.json({ results: [] }),
    () => Response.json({ results: [null] }),
    () => Response.json({ results: [{ results: [], meta: { changes: "not-a-number" } }] }),
  ]) await rejectsSafely(setup({ fetch: response }), "invalid_gateway_response");
});

test("network failures expose only approved network codes; timeout errors retain a distinct reason", async () => {
  const network = new Error("private-network-message", { cause: { code: "ENOTFOUND", token: SECRET } });
  const h = setup({ fetch: () => { throw network; } });
  await rejectsSafely(h, "gateway_network_error");
  assert.deepEqual(h.logs[0][1], { networkCode: "ENOTFOUND" });
  const unknown = setup({ fetch: () => { throw new Error("private-network-message", { cause: { code: SECRET } }); } });
  await rejectsSafely(unknown, "gateway_network_error");
  assert.deepEqual(unknown.logs[0][1], {});
  for (const name of ["AbortError", "TimeoutError"]) {
    const timeout = new DOMException("private-network-message", name);
    await rejectsSafely(setup({ fetch: () => { throw timeout; } }), "gateway_timeout");
    await rejectsSafely(setup({ fetch: () => ({ ok: true, json: () => { throw timeout; } }) }), "gateway_timeout");
  }
});

test("successful queries preserve credentials, disable caching and redirects, and retain development HTTP support", async () => {
  const secret = SECRET + "-exact-value";
  const h = setup({ env: { D1_GATEWAY_URL: ` ${ENDPOINT}\n`, D1_GATEWAY_SECRET: secret } });
  assert.deepEqual(await h.d1Batch(QUERY), RESPONSE.results);
  assert.equal(String(h.calls[0][0]), ENDPOINT);
  const init = h.calls[0][1];
  assert.equal(init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.equal(init.signal.aborted, false);
  assert.deepEqual(JSON.parse(init.body), { statements: QUERY });
  assert.deepEqual(h.logs, []);
  const local = setup({ env: { NODE_ENV: "development", D1_GATEWAY_URL: "http://127.0.0.1:8787/query" } });
  assert.deepEqual(await local.d1Query("SELECT id FROM example LIMIT ?", [1]), RESPONSE.results[0].results);
  const invalidLocal = setup({ env: { NODE_ENV: "development", D1_GATEWAY_URL: "ftp://127.0.0.1/query" } });
  await rejectsSafely(invalidLocal, "invalid_gateway_url");
});

test("content conflicts preserve their existing safe 409 response without infrastructure-error logging", async () => {
  const h = setup({ fetch: () => new Response("provider-sensitive-body", { status: 409 }) });
  await assert.rejects(h.d1Batch(QUERY), { status: 409, message: "This change conflicts with existing content." });
  assert.deepEqual(h.logs, []);
  const fallback = new h.DatabaseError();
  assert.equal(fallback.status, 503);
  assert.equal(fallback.message, GENERIC);
});
