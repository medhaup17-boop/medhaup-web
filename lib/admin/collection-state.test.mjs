import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./useCollectionRows.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Exercise the real hook's event handlers and async effects without a browser.
function harness(pageSize = 2) {
  const slots = [];
  const requests = [];
  const errors = [];
  let cursor = 0;
  let dirty = true;
  let value;
  let effects = [];
  const same = (previous, next) => previous?.length === next.length && next.every((dep, index) => Object.is(dep, previous[index]));
  const react = {
    useState(initial) {
      const position = cursor++;
      if (!slots[position]) {
        const state = { value: initial };
        state.set = (next) => {
          const result = typeof next === "function" ? next(state.value) : next;
          if (!Object.is(result, state.value)) { state.value = result; dirty = true; }
        };
        slots[position] = state;
      }
      return [slots[position].value, slots[position].set];
    },
    useRef(initial) {
      const position = cursor++;
      slots[position] ??= { current: initial };
      return slots[position];
    },
    useCallback(callback, dependencies) {
      const position = cursor++;
      if (!same(slots[position]?.dependencies, dependencies)) slots[position] = { callback, dependencies };
      return slots[position].callback;
    },
    useEffect(effect, dependencies) {
      const position = cursor++;
      if (!same(slots[position]?.dependencies, dependencies)) {
        const old = slots[position];
        const slot = { dependencies };
        slots[position] = slot;
        effects.push(() => { old?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  const api = {
    collectionPath: (slug) => `/collections/${slug}`,
    adminRequest(path, options) {
      return new Promise((resolve, reject) => requests.push({ path, signal: options.signal, resolve, reject }));
    },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", source)((name) => name === "react" ? react : api, loadedModule, loadedModule.exports);
  const onError = (message) => errors.push(message);
  function flush() {
    for (let attempts = 0; dirty && attempts < 20; attempts++) {
      dirty = false;
      cursor = 0;
      value = loadedModule.exports.useCollectionRows("products", pageSize, onError);
      const currentEffects = effects;
      effects = [];
      currentEffects.forEach((effect) => effect());
    }
    assert.equal(dirty, false, "hook should settle without a render loop");
  }
  flush();
  return {
    requests, errors,
    get current() { flush(); return value; },
    async settle() {
      for (let step = 0; step < 4; step++) { await Promise.resolve(); flush(); }
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}

const row = (id, published = true) => ({ id, title: `Item ${id}`, published });
async function seed(h, rows, hasMore = false) {
  h.requests.at(-1).resolve({ rows, hasMore });
  await h.settle();
}

test("confirmed deletes disappear immediately and remain gone when the list refresh fails", async () => {
  const h = harness();
  await seed(h, [row("a"), row("b")]);
  h.current.removeRow("a");
  assert.deepEqual(h.current.rows.map((item) => item.id), ["b"]);
  assert.equal(h.current.loading, false, "keep the remaining rows visible during background refresh");
  h.requests.at(-1).reject(new Error("Refresh unavailable"));
  await h.settle();
  assert.deepEqual(h.current.rows.map((item) => item.id), ["b"]);
  assert.deepEqual(h.errors, ["Refresh unavailable"]);
});

test("an older request cannot resurrect a deleted row after a second mutation", async () => {
  const h = harness();
  await seed(h, [row("a"), row("b")]);
  h.current.removeRow("a");
  const oldRequest = h.requests.at(-1);
  h.current.removeRow("b");
  const latestRequest = h.requests.at(-1);
  assert.equal(oldRequest.signal.aborted, true);
  latestRequest.resolve({ rows: [], hasMore: false });
  await h.settle();
  oldRequest.resolve({ rows: [row("b")], hasMore: false });
  await h.settle();
  assert.deepEqual(h.current.rows, []);
});

test("save and publish apply the server-confirmed row without waiting for another GET", async () => {
  const h = harness();
  await seed(h, [row("a", false)]);
  h.current.replaceRow({ ...row("a"), title: "Updated title" });
  assert.equal(h.current.rows[0].title, "Updated title");
  assert.equal(h.current.rows[0].published, true);
  assert.equal(h.requests.length, 1);
});

test("deleting the final item on a later page returns to the preceding page", async () => {
  const h = harness();
  await seed(h, [row("a"), row("b")], true);
  h.current.goToPage(1);
  await h.settle();
  await seed(h, [row("c")]);
  h.current.removeRow("c");
  assert.deepEqual(h.current.rows, []);
  assert.equal(h.current.page, 0);
  assert.match(h.requests.at(-1).path, /offset=0$/);
  await seed(h, [row("a"), row("b")]);
  assert.deepEqual(h.current.rows.map((item) => item.id), ["a", "b"]);
});

test("all confirmed batch uploads stay visible if refreshing the first page fails", async () => {
  const h = harness(4);
  await seed(h, [row("old")]);
  h.current.insertRows([row("new2"), row("new1")]);
  assert.deepEqual(h.current.rows.map((item) => item.id), ["new2", "new1", "old"]);
  h.requests.at(-1).reject(new Error("Network failed"));
  await h.settle();
  assert.deepEqual(h.current.rows.map((item) => item.id), ["new2", "new1", "old"]);
});

test("adding on a later page shows the new record on page one even if refresh fails", async () => {
  const h = harness();
  await seed(h, [row("a"), row("b")], true);
  h.current.goToPage(1);
  await h.settle();
  await seed(h, [row("c")]);
  h.current.insertRow(row("new"));
  assert.equal(h.current.page, 0);
  h.requests.at(-1).reject(new Error("Network failed"));
  await h.settle();
  assert.deepEqual(h.current.rows.map((item) => item.id), ["new"]);
});

test("empty pages after concurrent deletions move back until a populated page is found", async () => {
  const h = harness();
  await seed(h, [row("a"), row("b")], true);
  h.current.goToPage(2);
  await h.settle();
  await seed(h, []);
  assert.equal(h.current.page, 1);
  assert.equal(h.current.loading, true);
  await seed(h, []);
  assert.equal(h.current.page, 0);
  await seed(h, [row("a")]);
  assert.equal(h.current.loading, false);
  assert.equal(h.current.rows[0].id, "a");
});

test("unmount cancels reads and late failures do not alter the UI", async () => {
  const h = harness();
  h.unmount();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].reject(new Error("Late failure"));
  await h.settle();
  assert.deepEqual(h.errors, []);
});
