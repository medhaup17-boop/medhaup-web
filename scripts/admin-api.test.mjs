import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const ID = "e3745685-5ad4-4396-a6b3-247cdfbb9007";

function createLoader(overrides) {
  const cache = new Map();
  function load(path) {
    const filename = resolve(path);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function("require", "module", "exports", code)((name) => {
      if (name === "server-only") return {};
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith(".") || name.startsWith("@/")) {
        const base = name.startsWith("@/") ? resolve(name.slice(2)) : resolve(dirname(filename), name);
        return load(existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`);
      }
      return require(name);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
}

function harness(options = {}) {
  const events = [];
  class AdminAccessError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  const overrides = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "next/cache": {
      revalidateTag: (...args) => events.push(["tag", ...args]),
      revalidatePath: (...args) => events.push(["path", ...args]),
    },
    "@/lib/auth/admin": { AdminAccessError, requireAdmin: async () => {
      events.push(["auth"]);
      if (options.denied) throw new AdminAccessError("Access denied.", options.denied);
      return { userId: "user_editor" };
    } },
    "@/lib/storage/assets": {
      validateAssetReferences: async (...args) => { events.push(["assets", ...args]); },
      cleanupRecordAssets: async (row) => {
        events.push(["cleanup", row]);
        if (options.cleanupThrows) throw new Error("storage provider internals");
        return { deleted: 0, failed: options.cleanupFailed ?? 0 };
      },
    },
  };
  const load = createLoader(overrides);
  const validation = load("lib/db/validation.ts");
  overrides["@/lib/db/repository"] = {
    ValidationError: validation.ValidationError,
    listCollection: async (...args) => {
      events.push(["list", ...args]);
      if (options.listError) throw options.listError;
      return options.rows ?? [];
    },
    getCollectionRow: async (...args) => {
      events.push(["get", ...args]);
      return options.missing ? null : { id: ID, title: "Before", image: "https://assets.example.com/old.webp" };
    },
    createCollectionRow: async (slug, payload) => {
      events.push(["create", slug, payload]);
      if (options.writeFails) throw new Error("database password=hidden");
      return { id: ID, ...payload };
    },
    updateCollectionRow: async (slug, id, payload) => {
      events.push(["update", slug, id, payload]);
      return options.missing ? null : { id, ...payload };
    },
    deleteCollectionRow: async (...args) => {
      events.push(["delete", ...args]);
      return options.missing ? null : { id: ID, title: "Deleted" };
    },
    getSettings: async () => { events.push(["settings"]); return { phone: "9876543210" }; },
    saveSettings: async (payload) => {
      const data = validation.validateSettings(payload);
      events.push(["saveSettings", data]);
      return data;
    },
    getCollectionCounts: async () => {
      events.push(["counts"]);
      const { COLLECTIONS } = load("lib/admin/collections.ts");
      return Object.fromEntries(COLLECTIONS.map(({ slug }) => [slug, { total: 2, published: 1 }]));
    },
  };
  return {
    events,
    collection: load("app/api/admin/collections/[slug]/route.ts"),
    item: load("app/api/admin/collections/[slug]/[id]/route.ts"),
    settings: load("app/api/admin/settings/route.ts"),
    stats: load("app/api/admin/stats/route.ts"),
    utils: load("app/api/admin/_utils.ts"),
  };
}

function context(slug = "products") { return { params: Promise.resolve({ slug, id: ID }) }; }
function request(method = "GET", { path = "/collections/products", body, origin = "https://admin.example.com", contentType = "application/json" } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = contentType;
  return new Request(`https://admin.example.com/api/admin${path}`, { method, headers, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}

test("all CMS endpoints deny unauthenticated users before database or storage access", async () => {
  const h = harness({ denied: 401 });
  const responses = [
    await h.collection.GET(request(), context()),
    await h.collection.POST(request("POST", { body: {} }), context()),
    await h.item.PATCH(request("PATCH", { body: {} }), context()),
    await h.item.DELETE(request("DELETE"), context()),
    await h.settings.GET(),
    await h.settings.PUT(request("PUT", { body: {} })),
    await h.stats.GET(),
  ];
  assert.ok(responses.every((response) => response.status === 401));
  assert.ok(responses.every((response) => response.headers.get("cache-control") === "private, no-store"));
  assert.ok(h.events.every(([name]) => name === "auth"));
});

test("non-admin accounts and missing auth configuration fail closed", async () => {
  for (const status of [403, 503]) {
    const h = harness({ denied: status });
    assert.equal((await h.collection.GET(request(), context())).status, status);
    assert.deepEqual(h.events, [["auth"]]);
  }
});

test("mutations reject missing or forged origins before touching content", async () => {
  for (const origin of [null, "null", "https://evil.example", "https://admin.example.com.evil.example"]) {
    const h = harness();
    const response = await h.collection.POST(request("POST", { origin, body: { title: "Example" } }), context());
    assert.equal(response.status, 403);
    assert.deepEqual(h.events, [["auth"]]);
  }
});

test("listing requests one extra row but returns only the requested page", async () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const h = harness({ rows });
  const response = await h.collection.GET(request("GET", { path: "/collections/products?limit=2&offset=4" }), context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rows: rows.slice(0, 2), hasMore: true });
  assert.deepEqual(h.events.find(([name]) => name === "list"), ["list", "products", { limit: 3, offset: 4 }]);
});

test("the last page reports hasMore false and invalid pagination never queries D1", async () => {
  const h = harness({ rows: [{ id: "a" }] });
  assert.equal((await (await h.collection.GET(request(), context())).json()).hasMore, false);
  for (const query of ["limit=0", "limit=101", "limit=NaN", "offset=-1", "offset=0.5"]) {
    const bad = harness();
    assert.equal((await bad.collection.GET(request("GET", { path: `/collections/products?${query}` }), context())).status, 400);
    assert.deepEqual(bad.events, [["auth"]]);
  }
});

test("unknown collections and missing records return 404 without writes or invalidation", async () => {
  const h = harness({ missing: true });
  assert.equal((await h.collection.GET(request(), context("admins"))).status, 404);
  assert.equal((await h.item.PATCH(request("PATCH", { body: { title: "No" } }), context())).status, 404);
  assert.equal((await h.item.DELETE(request("DELETE"), context())).status, 404);
  assert.ok(!h.events.some(([name]) => ["create", "update", "tag", "path", "cleanup"].includes(name)));
});

test("successful content creation invalidates public content only after the write", async () => {
  const h = harness();
  const response = await h.collection.POST(request("POST", { body: { title: "New item" } }), context());
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).row, { id: ID, title: "New item" });
  assert.deepEqual(h.events.map(([name]) => name), ["auth", "assets", "create", "tag", "path"]);
  assert.deepEqual(h.events.find(([name]) => name === "tag"), ["tag", "content", { expire: 0 }]);
});

test("a failed write is sanitized and does not invalidate content", async () => {
  const h = harness({ writeFails: true });
  const response = await h.collection.POST(request("POST", { body: { title: "New item" } }), context());
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /password|hidden|SQL|https:/);
  assert.ok(!h.events.some(([name]) => name === "tag"));
});

test("database read failures do not expose provider responses", async () => {
  const h = harness({ listError: new Error("SELECT * secret token https://private.example") });
  const response = await h.collection.GET(request(), context());
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /SELECT|secret|token|private/);
});

test("cleanup failures report warnings after a successful update or delete", async () => {
  for (const options of [{ cleanupFailed: 1 }, { cleanupThrows: true }]) {
    for (const method of ["PATCH", "DELETE"]) {
      const h = harness(options);
      const response = await h.item[method](request(method, method === "PATCH" ? { body: { title: "Updated" } } : {}), context());
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.match(result.warning, /cleanup/i);
      assert.ok(method === "PATCH" ? result.row.id === ID : result.deleted);
      assert.ok(h.events.findIndex(([name]) => name === "tag") < h.events.findIndex(([name]) => name === "cleanup"));
    }
  }
});

test("settings accept the flat client payload and return the data envelope", async () => {
  const h = harness();
  const response = await h.settings.PUT(request("PUT", { body: { phone: "9876543210" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { phone: "9876543210" } });
  assert.ok(h.events.some(([name]) => name === "tag"));
  const wrong = await h.settings.PUT(request("PUT", { body: { data: { phone: "9876543210" } } }));
  assert.equal(wrong.status, 400);
});

test("stats preserve collection identity and dashboard counts", async () => {
  const response = await harness().stats.GET();
  const { stats } = await response.json();
  assert.equal(stats.length, 12);
  assert.ok(stats.every((item) => item.slug && item.title && item.total === 2 && item.published === 1));
});

test("JSON reader rejects malformed data, non-objects, invalid media types and oversized bodies", async () => {
  const { utils } = harness();
  for (const body of ["{", "null", "[]", '"text"']) {
    await assert.rejects(utils.readJson(request("POST", { body })), { status: 400 });
  }
  await assert.rejects(utils.readJson(request("POST", { body: {}, contentType: "application/jsonp" })), { status: 415 });
  await assert.rejects(utils.readJson(request("POST", { body: { value: "too large" } }), 5), { status: 413 });
  assert.deepEqual(await utils.readJson(request("POST", { body: { good: true }, contentType: "application/json; charset=utf-8" })), { good: true });
});
