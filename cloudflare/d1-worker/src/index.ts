type Value = string | number | null;
type Statement = { sql: string; params: Value[] };
type Result = { success: boolean; results?: Record<string, unknown>[]; meta?: { changes?: number } };
type PreparedStatement = { bind(...values: Value[]): PreparedStatement };
export type Env = {
  DB: { prepare(sql: string): PreparedStatement; batch(statements: PreparedStatement[]): Promise<Result[]> };
  D1_GATEWAY_SECRET: string;
};

const MAX_BODY_BYTES = 512_000;
const MAX_RESPONSE_BYTES = 8_000_000;
const MAX_STATEMENTS = 40;
const TABLES = new Set([
  "admins", "assets", "asset_references", "site_settings", "products", "blog_posts", "pyqs",
  "gallery_items", "success_photos", "current_affairs_monthly", "current_affairs_daily",
  "resources", "syllabus_subjects", "syllabus_downloads", "norcet_resources", "batches",
]);

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

/** Compare fixed-size digests, so comparison work does not depend on secret prefixes. */
export async function secretMatches(candidate: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new Error("BODY");
  if (!request.body) throw new Error("BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("BODY");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function validateStatements(body: unknown): Statement[] {
  if (!body || typeof body !== "object" || !("statements" in body) || !Array.isArray(body.statements) || Object.keys(body).length !== 1) throw new Error("INPUT");
  if (!body.statements.length || body.statements.length > MAX_STATEMENTS) throw new Error("INPUT");
  return body.statements.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("sql" in entry) || typeof entry.sql !== "string" || Object.keys(entry).some((key) => !["sql", "params"].includes(key))) throw new Error("INPUT");
    const sql = entry.sql.trim();
    const params = "params" in entry ? entry.params : [];
    // This is a private service gateway, not a public SQL endpoint. Browser
    // values are bound by the app repository; DDL and stacked SQL are rejected.
    if (!sql || sql.length > 16_000 || /[;`]|--|\/\*|\*\//.test(sql) || !/^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) throw new Error("INPUT");
    if (!Array.isArray(params) || params.length > 100 || params.some((value) => value !== null && !(typeof value === "string" && value.length <= 120_000) && !(typeof value === "number" && Number.isFinite(value)))) throw new Error("INPUT");
    if ((sql.match(/\?/g) ?? []).length !== params.length || /\?\d/.test(sql)) throw new Error("INPUT");
    const referenced = [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?!SET\b)([a-z_][a-z0-9_]*)/gi)].map((match) => match[1]);
    if (!referenced.length || referenced.some((table) => !TABLES.has(table))) throw new Error("INPUT");
    if (/^(UPDATE|DELETE)\b/i.test(sql) && !/\bWHERE\b/i.test(sql)) throw new Error("INPUT");
    // Every row-producing read is bounded. Aggregates return one row.
    const limits = [...sql.matchAll(/\bLIMIT\s+(\?|\d+)(?!\w)/gi)];
    for (const limit of limits) {
      const value = limit[1] === "?" ? params[(sql.slice(0, limit.index).match(/\?/g) ?? []).length] : Number(limit[1]);
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1000) throw new Error("INPUT");
    }
    if (/^SELECT\b/i.test(sql) && !limits.length && !/\bCOUNT\s*\(/i.test(sql)) throw new Error("INPUT");
    return { sql, params: params as Value[] };
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.D1_GATEWAY_SECRET || env.D1_GATEWAY_SECRET.length < 32 || !env.DB) return response({ error: "Service unavailable" }, 503);
    const authorization = request.headers.get("Authorization") ?? "";
    if (authorization.length > 1024 || !await secretMatches(authorization, `Bearer ${env.D1_GATEWAY_SECRET}`)) return response({ error: "Unauthorized" }, 401);
    if (request.method !== "POST" || new URL(request.url).pathname !== "/query") return response({ error: "Not found" }, 404);
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return response({ error: "Invalid request" }, 415);
    let statements: Statement[];
    try { statements = validateStatements(await readBody(request)); }
    catch { return response({ error: "Invalid request" }, 400); }
    try {
      const results = await env.DB.batch(statements.map(({ sql, params }) => env.DB.prepare(sql).bind(...params)));
      if (results.some((result) => !result.success)) throw new Error("QUERY");
      const body = JSON.stringify({ results: results.map((result) => ({ results: result.results ?? [], meta: { changes: result.meta?.changes ?? 0 } })) });
      if (new TextEncoder().encode(body).length > MAX_RESPONSE_BYTES) return response({ error: "Result exceeds limit" }, 413);
      return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch (error) {
      // Do not leak SQL, schema names, bindings or provider internals.
      const conflict = error instanceof Error && /constraint|unique|foreign key|asset.*ready/i.test(error.message);
      return response({ error: conflict ? "Content conflict" : "Query failed" }, conflict ? 409 : 503);
    }
  },
};
export default worker;
