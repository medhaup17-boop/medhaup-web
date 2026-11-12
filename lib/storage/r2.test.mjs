import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import sharp from "sharp";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTs(path, imports = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => Object.hasOwn(imports, name) ? imports[name] : require(name), loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}
const collections = loadTs("../admin/collections.ts");
const gateway = loadTs("../../cloudflare/d1-worker/src/index.ts");
const validation = loadTs("./validation.ts", { "@/lib/admin/collections": collections });
Object.assign(process.env, {
  R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret",
  R2_STAGING_BUCKET: "test-staging", R2_PUBLIC_BUCKET: "test-public", NEXT_PUBLIC_R2_PUBLIC_URL: "https://assets.example.com",
});

function harness(options = {}) {
  const bytes = options.bytes ?? Buffer.from("%PDF-1.7\nTest fixture\n%%EOF\n");
  const id = "b3ac6a2e-71e9-42e1-9bc1-17998bc91de7";
  const asset = {
    id, object_key: `assets/${id}/paper.pdf`, staging_key: `pending/${id}`,
    public_url: `https://assets.example.com/assets/${id}/paper.pdf`, original_name: "Exam paper.pdf",
    content_type: "application/pdf", size: bytes.length, owner_id: "user_admin", status: "pending",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...options.asset,
  };
  const calls = [];
  const db = [];
  let signed;
  const sdk = Object.fromEntries(["CopyObject", "DeleteObject", "GetObject", "HeadObject", "PutObject"].map((name) => [`${name}Command`, class {
    constructor(input) { this.input = input; this.kind = name; }
  }]));
  sdk.S3Client = class {
    async send(command) {
      calls.push(command);
      if (command.kind === "HeadObject") return {
        ContentLength: options.actualSize ?? bytes.length,
        ContentType: options.actualType ?? asset.content_type,
        ETag: '"validated-etag"',
      };
      if (command.kind === "GetObject") {
        const range = command.input.Range?.match(/^bytes=(\d+)-(\d+)$/);
        const body = range ? bytes.subarray(Number(range[1]), Number(range[2]) + 1) : bytes;
        return { ContentLength: body.length, Body: { transformToByteArray: async () => body } };
      }
      if (command.kind === "CopyObject" && options.copyFails) throw new Error("source changed");
      return {};
    }
  };
  async function d1Query(sql, params = []) {
    gateway.validateStatements({ statements: [{ sql, params }] });
    db.push({ sql, params });
    if (sql.startsWith("SELECT COUNT")) return [{ total: options.uploadCount ?? 0 }];
    if (sql.startsWith("INSERT INTO assets")) return [];
    if (sql.startsWith("SELECT * FROM assets WHERE id")) return params[1] === asset.owner_id ? [{ ...asset }] : [];
    if (sql.startsWith("SELECT * FROM assets WHERE public_url")) return params[0] === asset.public_url ? [{ ...asset }] : [];
    if (sql.startsWith("UPDATE assets SET status = 'processing'")) {
      if (options.claimConflict) return [];
      asset.status = "processing";
      return [{ ...asset }];
    }
    if (sql.startsWith("UPDATE assets SET status = 'ready'")) {
      if (options.databaseFailsAfterPromotion) throw new Error("database unavailable");
      asset.status = "ready"; asset.content_type = params[0]; asset.size = params[1]; return [];
    }
    if (sql.startsWith("UPDATE assets SET status = 'pending'")) { asset.status = "pending"; return []; }
    if (sql.startsWith("UPDATE assets SET status = 'deleting'")) {
      if (options.referenced) return [];
      asset.status = "deleting"; return [{ ...asset }];
    }
    if (sql.startsWith("DELETE FROM assets")) { asset.status = "deleted"; return []; }
    throw new Error(`Unexpected SQL in storage test: ${sql}`);
  }
  const r2 = loadTs("./r2.ts", {
    "server-only": {}, "@aws-sdk/client-s3": sdk,
    "@aws-sdk/s3-request-presigner": { getSignedUrl: async (_client, command, options) => { signed = { command, options }; return "https://signed.example.com"; } },
    "@/lib/cloudflare/d1": { d1Query }, "@/lib/admin/collections": collections, "./validation": validation,
  });
  return { r2, calls, db, asset, signed: () => signed };
}

test("upload signing binds expected type and length, and stores private staging metadata", async () => {
  const h = harness();
  const ticket = await h.r2.beginUpload({ collection: "pyq", field: "paper_url", fileName: "New paper.pdf", contentType: "application/pdf", size: 1024 }, "user_admin");
  assert.match(ticket.uploadId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(ticket.headers, { "Content-Type": "application/pdf" });
  assert.equal(h.signed().command.input.Bucket, "test-staging");
  assert.equal(h.signed().command.input.ContentLength, 1024);
  assert.ok(h.signed().options.signableHeaders.has("content-type"));
  assert.ok(h.signed().options.signableHeaders.has("content-length"));
  assert.equal(h.signed().options.expiresIn, 300);
  assert.equal(h.calls.length, 0);
});

test("PDF completion pins all reads and promotion to the same ETag and attaches downloads", async () => {
  const h = harness();
  const result = await h.r2.completeUpload(h.asset.id, "user_admin");
  assert.equal(result.url, h.asset.public_url);
  assert.equal(h.asset.status, "ready");
  for (const command of h.calls.filter((item) => item.kind === "GetObject")) assert.equal(command.input.IfMatch, '"validated-etag"');
  const copy = h.calls.find((item) => item.kind === "CopyObject");
  assert.equal(copy.input.CopySourceIfMatch, '"validated-etag"');
  assert.equal(copy.input.Bucket, "test-public");
  assert.match(copy.input.ContentDisposition, /^attachment;/);
  assert.ok(h.calls.some((item) => item.kind === "DeleteObject" && item.input.Bucket === "test-staging"));
  const count = h.calls.length;
  await h.r2.completeUpload(h.asset.id, "user_admin");
  assert.equal(h.calls.length, count, "completion retry is idempotent");
});

test("wrong size, spoofed bytes, source changes and concurrent completion cannot publish", async () => {
  for (const options of [{ actualSize: 9000 }, { bytes: Buffer.from("not a pdf") }, { copyFails: true }, { claimConflict: true }]) {
    const h = harness(options);
    await assert.rejects(h.r2.completeUpload(h.asset.id, "user_admin"));
    assert.notEqual(h.asset.status, "ready");
    if (!options.copyFails) assert.equal(h.calls.filter((item) => item.kind === "CopyObject" || item.kind === "PutObject").length, 0);
    assert.equal(h.calls.filter((item) => item.kind === "DeleteObject").length, 0);
  }
});

test("images are decoded, resized, stripped and saved as WebP with actual size metadata", async () => {
  const bytes = await sharp({ create: { width: 3000, height: 20, channels: 3, background: "orange" } }).png().toBuffer();
  const h = harness({ bytes, asset: { content_type: "image/png", size: bytes.length, original_name: "photo.png", object_key: "assets/test/photo.webp" } });
  await h.r2.completeUpload(h.asset.id, "user_admin");
  const put = h.calls.find((item) => item.kind === "PutObject");
  const metadata = await sharp(put.input.Body).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 2048);
  assert.equal(h.asset.content_type, "image/webp");
  assert.equal(h.asset.size, put.input.Body.length);
  assert.equal(put.input.ContentDisposition, "inline");
});

test("uncertain database failure after promotion does not delete a possibly referenced public object", async () => {
  const h = harness({ databaseFailsAfterPromotion: true });
  await assert.rejects(h.r2.completeUpload(h.asset.id, "user_admin"));
  assert.ok(h.calls.some((item) => item.kind === "CopyObject"));
  assert.equal(h.calls.filter((item) => item.kind === "DeleteObject").length, 0);
  assert.equal(h.asset.status, "processing");
});

test("ownership and shared references prevent deletion; an unreferenced upload deletes both objects", async () => {
  const shared = harness({ referenced: true, asset: { status: "ready" } });
  await assert.rejects(shared.r2.discardUpload(shared.asset.id, "user_other"));
  await assert.rejects(shared.r2.discardUpload(shared.asset.id, "user_admin"));
  assert.equal(shared.calls.length, 0);
  const unreferenced = harness();
  await unreferenced.r2.discardUpload(unreferenced.asset.id, "user_admin");
  assert.equal(unreferenced.asset.status, "deleted");
  assert.deepEqual(unreferenced.calls.map((item) => item.input.Bucket).sort(), ["test-public", "test-staging"]);
});

test("managed aliases and arbitrary image hosts cannot bypass ready asset validation", async () => {
  const h = harness({ asset: { status: "ready" } });
  await h.r2.validateAssetReferences("pyq", { paper_url: h.asset.public_url });
  await assert.rejects(h.r2.validateAssetReferences("pyq", { paper_url: `${h.asset.public_url}?alias=1` }));
  await assert.rejects(h.r2.validateAssetReferences("products", { image: "https://unapproved.example.com/x.jpg" }));
  await h.r2.validateAssetReferences("products", { image: "https://ik.imagekit.io/demo/image.jpg" });
  await h.r2.validateAssetReferences("pyq", { paper_url: "https://external.example.org/syllabus.pdf" });
});

test("article cleanup finds embedded managed links and still respects shared references", async () => {
  const h = harness({ asset: { status: "ready" } });
  const result = await h.r2.cleanupRecordAssets({ content: `Read [this resource](${h.asset.public_url}#page=2).` });
  assert.deepEqual(result, { deleted: 1, failed: 0 });
  const shared = harness({ referenced: true, asset: { status: "ready" } });
  assert.deepEqual(await shared.r2.cleanupRecordAssets({ content: `Read ${shared.asset.public_url}` }), { deleted: 0, failed: 0 });
  assert.equal(shared.calls.length, 0);
});
