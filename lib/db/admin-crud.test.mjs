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
const origin = "https://admin.example.test";
const compiled = new Map();
const schema = ["0001_fresh_content.sql", "0002_admin_auth.sql"].map((name) =>
  readFileSync(resolve(root, "cloudflare/d1-worker/migrations", name), "utf8"),
).join("\n");

function harness() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const environment = {
    D1_GATEWAY_URL: "https://d1.example.test/query",
    D1_GATEWAY_SECRET: "test-only-admin-content-gateway-secret",
    NEXT_PUBLIC_R2_PUBLIC_URL: "https://assets.example.test",
  };
  const state = { authorized: true, databaseDown: false, cleanupFails: false, cleanupCalls: 0 };
  const afterTasks = [];
  const invalidations = [];
  const publicCaches = [];
  class AdminAccessError extends Error {
    constructor() { super("Sign in to continue."); this.status = 401; }
  }
  const overrides = {
    "server-only": {},
    react: { cache: (fn) => fn },
    "next/server": { ...require("next/server"), after: (callback) => afterTasks.push(callback) },
    "next/cache": {
      unstable_cache(fn, keys, options) {
        const values = new Map();
        publicCaches.push({ values, tags: options.tags });
        return async (...args) => {
          const key = JSON.stringify(args);
          if (!values.has(key)) values.set(key, await fn(...args));
          return values.get(key);
        };
      },
      revalidateTag(tag, profile) {
        invalidations.push(["tag", tag, profile]);
        assert.deepEqual(profile, { expire: 0 }, "mutations must expire public reads immediately");
        for (const cache of publicCaches) if (cache.tags.includes(tag)) cache.values.clear();
      },
      revalidatePath: (...args) => invalidations.push(["path", ...args]),
    },
    "@/lib/auth/admin": {
      AdminAccessError,
      async requireAdmin() {
        if (!state.authorized) throw new AdminAccessError();
        return { userId: "single-admin" };
      },
    },
    "@/lib/storage/assets": {
      validateAssetReferences: (...args) => load("lib/storage/r2.ts").validateAssetReferences(...args),
      async cleanupRecordAssets() {
        state.cleanupCalls++;
        if (state.cleanupFails) throw new Error("Simulated R2 failure");
        return { deleted: 0, failed: 0 };
      },
    },
  };
  const modules = new Map();
  let worker;
  const workerEnv = {
    D1_GATEWAY_SECRET: environment.D1_GATEWAY_SECRET,
    DB: {
      prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
      async batch(statements) {
        if (state.databaseDown) throw new Error("Simulated database failure");
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
  function load(path) {
    const filename = resolve(root, path);
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} };
    modules.set(filename, mod);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
    new Function("require", "module", "exports", "process", "fetch", compiled.get(filename))((name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith(".") || name.startsWith("@/")) {
        return load(`${name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(filename), name)}.ts`);
      }
      return require(name);
    }, mod, mod.exports, { env: environment }, (url, options) => worker.fetch(new Request(url, options), workerEnv));
    return mod.exports;
  }
  worker = load("cloudflare/d1-worker/src/index.ts").default;
  return {
    db, state, afterTasks, invalidations,
    repository: load("lib/db/repository.ts"),
    definition: load("lib/db/validation.ts").collectionDefinition,
    collections: load("lib/admin/collections.ts").COLLECTIONS,
    data: load("lib/data.ts"),
    list: load("app/api/admin/collections/[slug]/route.ts"),
    item: load("app/api/admin/collections/[slug]/[id]/route.ts"),
    settings: load("app/api/admin/settings/route.ts"),
    async flushCleanup() { while (afterTasks.length) await afterTasks.shift()(); },
  };
}

function request(method, body, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/collections/test`, {
    method,
    headers: { Origin: requestOrigin, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function context(slug, id) { return { params: Promise.resolve({ slug, id }) }; }

async function result(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return body;
}

function payload(collection, db) {
  return Object.fromEntries(collection.fields.map((field) => {
    let value;
    switch (field.type) {
      case "boolean": value = true; break;
      case "number": value = field.name === "year" ? 2026 : field.name === "seats_total" ? 10 : 2; break;
      case "select": value = field.options[0]; break;
      case "date": value = "2026-11-13"; break;
      case "tags": value = ["Study", "Exam preparation"]; break;
      case "file":
      case "image": {
        const id = crypto.randomUUID();
        const extension = field.type === "file" ? "pdf" : "webp";
        const objectKey = `assets/${id}/${field.name}.${extension}`;
        value = `https://assets.example.test/${objectKey}`;
        db.prepare("INSERT INTO assets (id, object_key, staging_key, public_url, original_name, content_type, size, owner_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, objectKey, `pending/${id}`, value, `${field.name}.${extension}`, field.type === "file" ? "application/pdf" : "image/webp", 100, "single-admin", "ready");
        break;
      }
      default: value = `${field.name}-${collection.slug}`;
    }
    return [field.name, value];
  }));
}

const publicGetters = {
  products: "getProducts", blogs: "getPosts", pyq: "getPYQs", gallery: "getGallery",
  "success-photos": "getSuccessPhotos", "current-affairs-monthly": "getMonthlyCA",
  "current-affairs-daily": "getDailyCA", resources: "getResources",
  "syllabus-subjects": "getSubjects", "syllabus-downloads": "getSyllabusDownloads",
  "norcet-resources": "getNorcetResources", batches: "getBatches",
};

test("every admin collection creates, edits, publishes, unpublishes, and deletes through its real API and public fetcher", async (t) => {
  const inventory = harness();
  const collections = inventory.collections;
  inventory.db.close();
  assert.deepEqual(Object.keys(publicGetters), collections.map((collection) => collection.slug));
  for (const collection of collections) await t.test(collection.slug, async () => {
    const h = harness();
    try {
      const input = payload(h.definition(collection.slug), h.db);
      const getPublic = h.data[publicGetters[collection.slug]];
      assert.deepEqual(await getPublic(), []); // Prime an empty public cache first.
      const { row } = await result(await h.list.POST(request("POST", input), context(collection.slug)), 201);
      assert.equal(row.published, false);
      assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM asset_references WHERE row_id = ?").get(row.id).n,
        h.definition(collection.slug).fields.filter((field) => ["image", "file"].includes(field.type)).length);
      assert.deepEqual(await getPublic(), []);
      assert.equal((await result(await h.list.GET(request("GET"), context(collection.slug)))).rows[0].id, row.id);
      await result(await h.item.PATCH(request("PATCH", { published: true }), context(collection.slug, row.id)));
      const [published] = await getPublic();
      assert.equal(published.id, row.id);
      for (const [key, value] of Object.entries(input)) {
        if (key === "content") {
          assert.equal((await h.data.getPostBySlug(row.slug)).content, value);
        } else {
          const property = collection.slug === "success-photos" && key === "src" ? "image" : key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
          assert.deepEqual(published[property], value, `${collection.slug}.${property}`);
        }
      }
      const titleField = collection.listCols[0];
      const changed = `Updated ${collection.slug}`;
      await result(await h.item.PATCH(request("PATCH", { [titleField]: changed }), context(collection.slug, row.id)));
      assert.equal((await getPublic())[0][titleField], changed);
      await result(await h.item.PATCH(request("PATCH", { published: false }), context(collection.slug, row.id)));
      assert.deepEqual(await getPublic(), []);
      await result(await h.item.PATCH(request("PATCH", { published: true }), context(collection.slug, row.id)));
      assert.equal((await getPublic()).length, 1);
      await result(await h.item.DELETE(request("DELETE"), context(collection.slug, row.id)));
      assert.deepEqual((await result(await h.list.GET(request("GET"), context(collection.slug)))).rows, []);
      assert.deepEqual(await getPublic(), []);
      if (collection.slug === "blogs") assert.equal(await h.data.getPostBySlug(row.slug), null);
      assert.equal(await h.repository.getCollectionRow(collection.slug, row.id), null);
      assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM asset_references WHERE row_id = ?").get(row.id).n, 0);
      assert.deepEqual((await h.repository.getCollectionCounts())[collection.slug], { total: 0, published: 0 });
      assert.equal(h.state.cleanupCalls, 0, "R2 cleanup must not delay the mutation response");
      assert.ok(h.invalidations.some((entry) => JSON.stringify(entry) === JSON.stringify(["path", "/", "layout"])));
      await h.flushCleanup();
      assert.ok(h.state.cleanupCalls > 0);
    } finally { h.db.close(); }
  });
});

test("settings update the public cached settings immediately and preserve omitted fields", async () => {
  const h = harness();
  try {
    await h.data.getSiteSettings();
    await result(await h.settings.PUT(request("PUT", { phone: "9876543210", email: "new@example.test" })));
    assert.equal((await h.data.getSiteSettings()).phone, "9876543210");
    await result(await h.settings.PUT(request("PUT", { address: "New office" })));
    const settings = (await result(await h.settings.GET())).data;
    assert.deepEqual(settings, { phone: "9876543210", email: "new@example.test", address: "New office" });
    assert.equal((await h.data.getSiteSettings()).email, "new@example.test");
    assert.equal((await h.data.getSiteSettings()).address, "New office");
  } finally { h.db.close(); }
});

test("failed deletion leaves content visible and never schedules cleanup or invalidation", async () => {
  const h = harness();
  try {
    const row = await h.repository.createCollectionRow("products", { title: "Retained", price: 1, published: true });
    h.state.databaseDown = true;
    await result(await h.item.DELETE(request("DELETE"), context("products", row.id)), 503);
    assert.deepEqual(h.invalidations, []);
    assert.deepEqual(h.afterTasks, []);
    h.state.databaseDown = false;
    assert.equal((await h.repository.getCollectionRow("products", row.id)).title, "Retained");
    await result(await h.item.DELETE(request("DELETE", undefined, "https://attacker.example.test"), context("products", row.id)), 403);
    h.state.authorized = false;
    await result(await h.item.DELETE(request("DELETE"), context("products", row.id)), 401);
    assert.equal((await h.repository.getCollectionRow("products", row.id)).title, "Retained");
  } finally { h.db.close(); }
});

test("deletion is durable before storage cleanup and an R2 failure cannot restore deleted content", async () => {
  const h = harness();
  try {
    const row = await h.repository.createCollectionRow("products", { title: "Removed", price: 1, published: true });
    await h.data.getProducts();
    h.state.cleanupFails = true;
    assert.deepEqual(await result(await h.item.DELETE(request("DELETE"), context("products", row.id))), { deleted: true });
    assert.equal(h.state.cleanupCalls, 0);
    assert.deepEqual(await h.data.getProducts(), []);
    const original = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try { await h.flushCleanup(); } finally { console.error = original; }
    assert.equal(h.state.cleanupCalls, 1);
    assert.equal(errors.length, 1);
    assert.equal(await h.repository.getCollectionRow("products", row.id), null);
    await result(await h.item.DELETE(request("DELETE"), context("products", row.id)), 404);
  } finally { h.db.close(); }
});
