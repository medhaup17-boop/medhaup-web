import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const loaded = new Map();
function load(relative) {
  const filename = resolve(root, relative);
  if (loaded.has(filename)) return loaded.get(filename);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", source)((name) => {
    if (name === "server-only") return {};
    if (name.startsWith(".")) return load(resolve(dirname(filename), name + ".ts"));
    return require(name);
  }, loadedModule, loadedModule.exports);
  loaded.set(filename, loadedModule.exports);
  return loadedModule.exports;
}

const { default: worker, secretMatches, validateStatements } = load("cloudflare/d1-worker/src/index.ts");
const repository = load("lib/db/repository.ts");
const { validatePayload, collectionDefinition } = load("lib/db/validation.ts");
const schema = readFileSync(new URL("../migrations/0001_fresh_content.sql", import.meta.url), "utf8");
const SECRET = "test-only-32-character-minimum-shared-secret";
process.env.D1_GATEWAY_URL = "https://d1.example.test/query";
process.env.D1_GATEWAY_SECRET = SECRET;
process.env.NEXT_PUBLIC_R2_PUBLIC_URL = "https://assets.example.test";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  let calls = 0;
  const env = {
    D1_GATEWAY_SECRET: SECRET,
    DB: {
      prepare(sql) { return { bind(...params) { return { sql, params }; } }; },
      async batch(statements) {
        calls++;
        db.exec("BEGIN");
        try {
          const result = statements.map(({ sql, params }) => ({ success: true, results: db.prepare(sql).all(...params), meta: { changes: Number(db.prepare("SELECT changes() AS n").get().n) } }));
          db.exec("COMMIT");
          return result;
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      },
    },
  };
  globalThis.fetch = async (url, options) => worker.fetch(new Request(url, options), env);
  return { db, env, calls: () => calls };
}

function request(body, secret = SECRET) {
  return new Request("https://d1.example.test/query", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function addAsset(db, status = "ready") {
  const id = crypto.randomUUID();
  const url = `https://assets.example.test/assets/${id}/image.webp`;
  db.prepare("INSERT INTO assets (id, object_key, staging_key, public_url, original_name, content_type, size, owner_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, `assets/${id}/image.webp`, `pending/${id}`, url, "image.webp", "image/webp", 100, "user_testadmin", status);
  return { id, url };
}

test("fresh schema covers every CMS field, starts empty, and grants no admins", () => {
  const { db } = setup();
  const { COLLECTIONS } = load("lib/admin/collections.ts");
  for (const raw of COLLECTIONS) {
    const collection = collectionDefinition(raw.slug);
    const fields = db.prepare(`PRAGMA table_info(${collection.table})`).all().map((column) => column.name);
    for (const name of ["id", "published", "created_at", "updated_at", ...collection.fields.map((field) => field.name)]) assert.ok(fields.includes(name), `${collection.table}.${name}`);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${collection.table}`).get().n, 0);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admins").get().n, 0);
  assert.throws(() => db.prepare("INSERT INTO admins (clerk_user_id) VALUES (NULL)").run());
  db.close();
});

test("gateway authenticates before executing SQL and does not expose internal errors", async () => {
  const { env, db, calls } = setup();
  assert.equal(await secretMatches(SECRET, SECRET), true);
  assert.equal(await secretMatches(SECRET + "x", SECRET), false);
  const query = { statements: [{ sql: "SELECT id FROM products LIMIT ?", params: [1] }] };
  assert.equal((await worker.fetch(request(query, "wrong"), env)).status, 401);
  assert.equal(calls(), 0);
  assert.equal((await worker.fetch(request(query), { ...env, D1_GATEWAY_SECRET: "" })).status, 503);
  assert.equal(calls(), 0);
  const failed = await worker.fetch(request({ statements: [{ sql: "SELECT secret_internal_column FROM products LIMIT ?", params: [1] }] }), env);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Query failed" });
  db.close();
});

test("gateway rejects SQL stacking, unrestricted reads, excessive limits and invalid binds", () => {
  for (const statement of [
    { sql: "DROP TABLE products", params: [] },
    { sql: "SELECT * FROM products; DELETE FROM products", params: [] },
    { sql: "SELECT * FROM sqlite_master LIMIT ?", params: [1] },
    { sql: "SELECT * FROM products", params: [] },
    { sql: "SELECT * FROM products LIMIT ?", params: [-1] },
    { sql: "SELECT * FROM products LIMIT ?", params: [1001] },
    { sql: "SELECT * FROM products LIMIT ?", params: [1, 2] },
    { sql: "DELETE FROM products", params: [] },
  ]) assert.throws(() => validateStatements({ statements: [statement] }));
  assert.throws(() => validateStatements({ statements: Array(41).fill({ sql: "SELECT COUNT(*) FROM products" }) }));
});

test("repository binds values and rejects unknown collections, columns and invalid types", async () => {
  const { db, calls } = setup();
  await assert.rejects(repository.listCollection("products; DROP TABLE admins"), /Unknown/);
  await assert.rejects(repository.createCollectionRow("products", { title: "Product", price: 1, admin: true }), /cannot be changed/);
  await assert.rejects(repository.createCollectionRow("products", { title: "Product", price: "10" }), /number/);
  await assert.rejects(repository.createCollectionRow("products", { title: "Product", price: -1 }), /non-negative/);
  await assert.rejects(repository.createCollectionRow("products", { title: "Product", price: 1, image: "javascript:alert(1)" }), /HTTPS/);
  assert.equal(calls(), 0);
  const title = "O'Reilly'); DROP TABLE admins; --";
  const row = await repository.createCollectionRow("products", { title, price: 10 });
  assert.equal(row.title, title);
  assert.equal(row.published, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admins").get().n, 0);
  db.close();
});

test("CRUD preserves draft boundaries, booleans, tags, projections, settings and membership", async () => {
  const { db } = setup();
  const draft = await repository.createCollectionRow("blogs", { title: "A new post", content: "Full article body", tags: ["Study"], published: false });
  assert.equal(draft.slug, "a-new-post");
  assert.deepEqual(draft.tags, ["Study"]);
  assert.equal((await repository.listPublishedRows("blog_posts")).length, 0);
  assert.equal(await repository.getPublishedPost(draft.slug), null);
  const published = await repository.updateCollectionRow("blogs", draft.id, { published: true });
  assert.equal(published.published, true);
  assert.equal((await repository.listPublishedRows("blog_posts"))[0].content, "");
  assert.equal((await repository.getPublishedPost(draft.slug)).content, "Full article body");
  assert.equal((await repository.getCollectionCounts()).blogs.published, 1);
  await repository.saveSettings({ email: "hello@example.test" });
  await repository.saveSettings({ phone: "8910840928" });
  assert.deepEqual(await repository.getSettings(), { email: "hello@example.test", phone: "8910840928" });
  assert.equal(await repository.isAdmin("user_testadmin"), false);
  db.prepare("INSERT INTO admins (clerk_user_id) VALUES (?)").run("user_testadmin");
  assert.equal(await repository.isAdmin("user_testadmin"), true);
  assert.equal(await repository.isAdmin("user_testadmin' OR 1=1"), false);
  assert.equal((await repository.deleteCollectionRow("blogs", draft.id)).id, draft.id);
  assert.equal(await repository.getCollectionRow("blogs", draft.id), null);
  assert.equal(await repository.updateCollectionRow("blogs", draft.id, { published: false }), null);
  db.close();
});

test("SQLite constraints reject invalid enumerations, duplicate slugs and bad JSON", async () => {
  const { db } = setup();
  await repository.createCollectionRow("blogs", { title: "Same slug" });
  await assert.rejects(repository.createCollectionRow("blogs", { title: "Same slug" }), (error) => error.status === 409 && !error.message.includes("UNIQUE"));
  assert.throws(() => db.prepare("INSERT INTO blog_posts(id,title,slug,tags) VALUES(?,?,?,?)").run("id", "title", "slug", "{}"));
  assert.throws(() => db.prepare("INSERT INTO norcet_resources(id,title,file_url,category) VALUES(?,?,?,?)").run("id", "title", "https://example.test/x.pdf", "invalid"));
  assert.throws(() => validatePayload(collectionDefinition("blogs"), { date: "2026-02-30" }));
  assert.throws(() => validatePayload(collectionDefinition("pyq"), { year: 2026.5 }));
  db.close();
});

test("managed asset references are atomic and prevent cleanup races", async () => {
  const { db } = setup();
  const asset = addAsset(db);
  const product = await repository.createCollectionRow("products", { title: "Book", price: 10, image: asset.url });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM asset_references WHERE asset_id = ?").get(asset.id).n, 1);
  assert.throws(() => db.prepare("UPDATE assets SET status = 'deleting' WHERE id = ?").run(asset.id));
  assert.throws(() => db.prepare("DELETE FROM assets WHERE id = ?").run(asset.id));
  const pending = addAsset(db, "pending");
  await assert.rejects(repository.updateCollectionRow("products", product.id, { title: "Do not commit", image: pending.url }), (error) => error.status === 409);
  assert.equal((await repository.getCollectionRow("products", product.id)).title, "Book");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM asset_references WHERE asset_id = ?").get(asset.id).n, 1);
  await assert.rejects(repository.createCollectionRow("products", { title: "Missing asset", price: 1, image: "https://assets.example.test/assets/missing/image.webp" }), (error) => error.status === 409);
  assert.equal((await repository.getCollectionCounts()).products.total, 1);
  await repository.deleteCollectionRow("products", product.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM asset_references").get().n, 0);
  db.prepare("UPDATE assets SET status = 'deleting' WHERE id = ?").run(asset.id);
  await assert.rejects(repository.createCollectionRow("products", { title: "Deleting asset", price: 1, image: asset.url }), (error) => error.status === 409);
  db.close();
});

test("article Markdown retains managed assets when their cover reference changes", async () => {
  const { db } = setup();
  const asset = addAsset(db);
  const post = await repository.createCollectionRow("blogs", { title: "Picture", cover: asset.url, content: `![Image](${asset.url})` });
  await repository.updateCollectionRow("blogs", post.id, { cover: null });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM asset_references WHERE asset_id = ?").get(asset.id).n, 1);
  assert.throws(() => db.prepare("UPDATE assets SET status = 'deleting' WHERE id = ?").run(asset.id));
  await repository.updateCollectionRow("blogs", post.id, { content: "Removed image" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM asset_references WHERE asset_id = ?").get(asset.id).n, 0);
  db.close();
});

function loadData(repositoryMock, configured = true) {
  const cacheOptions = [];
  const cacheSizes = [];
  const source = ts.transpileModule(readFileSync(resolve(root, "lib/data.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  const imports = {
    react: { cache: (fn) => fn },
    "next/cache": { unstable_cache(fn, keys, options) {
      cacheOptions.push(options);
      const values = new Map();
      return async (...args) => {
        const key = JSON.stringify(args);
        if (!values.has(key)) values.set(key, Promise.resolve().then(() => fn(...args)).then((value) => {
          // unstable_cache stores serialized results in a FETCH cache entry.
          // Check UTF-8 bytes as well as JS length, covering hosted caches too.
          const size = Buffer.byteLength(JSON.stringify({ kind: "FETCH", data: { body: JSON.stringify(value) } }));
          cacheSizes.push(size);
          assert.ok(size < 2 * 1024 * 1024, "cache entry must fit Next's 2 MB limit");
          return value;
        }).catch((error) => { values.delete(key); throw error; }));
        return values.get(key);
      };
    } },
    "./cloudflare/d1": { isDatabaseConfigured: () => configured },
    "./db/repository": { getSettings: async () => ({}), getPublishedPost: async () => null, ...repositoryMock },
    "./batches": {},
    "./settings": load("lib/settings.ts"),
  };
  new Function("require", "module", "exports", source)((name) => imports[name] ?? require(name), loadedModule, loadedModule.exports);
  return { ...loadedModule.exports, cacheOptions, cacheSizes };
}

test("public data caches published reads, paginates fully, and decodes names", async () => {
  const calls = [];
  const data = loadData({ listPublishedRows: async (table, options) => {
    calls.push({ table, ...options });
    return Array.from({ length: Math.min(options.limit, 51 - options.offset) }, (_, index) => ({ id: `${index + options.offset}`, paper_url: `https://assets.example.test/${index + options.offset}.pdf` }));
  } });
  const first = await data.getPYQs();
  assert.equal(first.length, 51);
  assert.equal(first[50].paperUrl, "https://assets.example.test/50.pdf");
  assert.deepEqual(await data.getPYQs(), first);
  assert.deepEqual(calls, Array.from({ length: 6 }, (_, page) => ({ table: "pyqs", limit: 10, offset: page * 10 })));
  assert.equal(data.cacheSizes.length, 6);
  assert.ok(data.cacheOptions.every((options) => options.revalidate === 300 && options.tags.includes("content")));
});

test("missing configuration renders empty public content without fetching", async () => {
  const data = loadData({ listPublishedRows: async () => { throw new Error("must not fetch"); }, getSettings: async () => { throw new Error("must not fetch"); } }, false);
  assert.deepEqual(await data.getPYQs(), []);
  assert.equal(await data.getPostBySlug("valid-slug"), null);
  assert.deepEqual(await data.getSiteSettings(), load("lib/settings.ts").SITE_DEFAULTS);
});

test("an outage does not persist an empty public cache entry", async () => {
  let count = 0;
  const data = loadData({ listPublishedRows: async () => {
    if (++count === 1) throw new Error("temporary failure");
    return [{ id: "restored", paper_url: "https://assets.example.test/paper.pdf" }];
  } });
  const oldError = console.error;
  console.error = () => {};
  try { assert.deepEqual(await data.getPYQs(), []); }
  finally { console.error = oldError; }
  assert.equal((await data.getPYQs())[0].id, "restored");
  assert.equal(count, 2);
});

test("admin pagination returns stable distinct pages and validates bounds", async () => {
  const { db } = setup();
  for (let i = 0; i < 3; i++) await repository.createCollectionRow("products", { title: `Product ${i}`, price: i });
  const first = await repository.listCollection("products", { limit: 2, offset: 0 });
  const second = await repository.listCollection("products", { limit: 2, offset: 2 });
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  assert.equal(new Set([...first, ...second].map((row) => row.id)).size, 3);
  await assert.rejects(repository.listCollection("products", { limit: 0 }), /pagination/);
  await assert.rejects(repository.listCollection("products", { offset: -1 }), /pagination/);
  await assert.rejects(repository.listCollection("products", { limit: 1001 }), /pagination/);
  db.close();
});

test("large valid public datasets use small cache entries without truncating rows", async () => {
  const escaped = "\u0001";
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `${index}`,
    title: escaped.repeat(2048),
    category: "Notes",
    stage: "Both stages",
    subject: escaped.repeat(2048),
    description: escaped.repeat(8000),
    language: "English",
    file_url: `https://assets.example.test/${"x".repeat(1900)}-${index}.pdf`,
    file_size: escaped.repeat(2048),
    is_new: false,
  }));
  // Every row respects the repository's per-field limits, yet a collection
  // cache would exceed the platform limit once escaping is accounted for.
  for (const { id: ignored, ...payload } of rows) {
    assert.ok(ignored);
    validatePayload(collectionDefinition("norcet-resources"), payload, true);
  }
  assert.ok(Buffer.byteLength(JSON.stringify({ data: { body: JSON.stringify(rows) } })) > 2 * 1024 * 1024);
  let calls = 0;
  const data = loadData({ listPublishedRows: async (table, { limit, offset }) => {
    calls++;
    assert.equal(table, "norcet_resources");
    assert.equal(limit, 10);
    const page = rows.slice(offset, offset + limit);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 8_000_000);
    return page;
  } });
  assert.equal((await data.getNorcetResources()).length, rows.length);
  assert.equal((await data.getNorcetResources()).length, rows.length);
  assert.equal(calls, 6);
  assert.equal(data.cacheSizes.length, 6);
});

test("a failed later page is retried while earlier successful pages stay cached", async () => {
  const calls = [];
  let failed = false;
  const data = loadData({ listPublishedRows: async (table, { limit, offset }) => {
    calls.push(offset);
    if (offset === 10 && !failed) { failed = true; throw new Error("temporary failure"); }
    return Array.from({ length: offset === 0 ? limit : 1 }, (_, index) => ({ id: `${offset + index}`, paper_url: "https://example.test/paper.pdf" }));
  } });
  const oldError = console.error;
  console.error = () => {};
  try { assert.deepEqual(await data.getPYQs(), []); }
  finally { console.error = oldError; }
  assert.equal((await data.getPYQs()).length, 11);
  assert.deepEqual(calls, [0, 10, 10]);
  assert.equal(data.cacheSizes.length, 2);
});
