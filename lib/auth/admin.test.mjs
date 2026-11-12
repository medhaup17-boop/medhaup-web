import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function loadGuard({ configured = true, userId = "user_editor", allowed = true, authError, databaseError } = {}) {
  const checked = [];
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./admin.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const imports = {
    "server-only": {},
    "@clerk/nextjs/server": { auth: async (options) => {
      assert.equal(options.acceptsToken, "session_token");
      if (authError) throw new Error("secret auth failure");
      return { userId };
    } },
    "@/lib/db/repository": { isAdmin: async (id) => {
      checked.push(id);
      if (databaseError) throw new Error("secret database failure");
      return typeof allowed === "function" ? allowed() : allowed;
    } },
    "next/navigation": { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); } },
    "./config": { isClerkConfigured: () => configured },
  };
  new Function("require", "exports", code)((id) => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
    return imports[id];
  }, exports);
  return { ...exports, checked };
}

test("missing configuration fails closed without querying membership", async () => {
  const guard = loadGuard({ configured: false });
  await assert.rejects(guard.requireAdmin(), { status: 503 });
  assert.deepEqual(guard.checked, []);
});

test("signed-out users cannot reach membership or admin data", async () => {
  const guard = loadGuard({ userId: null });
  await assert.rejects(guard.requireAdmin(), { status: 401 });
  assert.deepEqual(guard.checked, []);
});

test("a valid Clerk session does not confer administrator access", async () => {
  const guard = loadGuard({ allowed: false });
  await assert.rejects(guard.requireAdmin(), { status: 403 });
  assert.deepEqual(guard.checked, ["user_editor"]);
});

test("Clerk or membership infrastructure failures never grant access or expose internals", async () => {
  for (const options of [{ authError: true }, { databaseError: true }]) {
    const guard = loadGuard(options);
    await assert.rejects(guard.requireAdmin(), (error) => error.status === 503 && !error.message.includes("secret"));
  }
});

test("only an authenticated administrator receives the verified Clerk ID", async () => {
  const guard = loadGuard();
  assert.deepEqual(await guard.requireAdmin(), { userId: "user_editor" });
  assert.deepEqual(guard.checked, ["user_editor"]);
});

test("membership is checked again after an administrator is removed", async () => {
  let member = true;
  const guard = loadGuard({ allowed: () => member });
  await guard.requireAdmin();
  member = false;
  await assert.rejects(guard.requireAdmin(), { status: 403 });
  assert.equal(guard.checked.length, 2);
});

test("page guard redirects signed-out users but preserves denied-access errors", async () => {
  await assert.rejects(loadGuard({ userId: null }).requireAdminPage(), { url: "/admin/login" });
  await assert.rejects(loadGuard({ allowed: false }).requireAdminPage(), { status: 403 });
});
