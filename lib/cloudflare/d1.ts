import "server-only";

export type D1Value = string | number | null;
export type D1Statement = { sql: string; params?: D1Value[] };
export type D1QueryResult<T = Record<string, unknown>> = {
  results: T[];
  meta: { changes: number };
};

export class DatabaseError extends Error {
  constructor(public readonly status = 503) {
    super(status === 409 ? "This change conflicts with existing content." : "The content database is unavailable. Please try again.");
    this.name = "DatabaseError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.D1_GATEWAY_URL && process.env.D1_GATEWAY_SECRET);
}

/** Never expose this gateway or its secret through browser bundles. */
export async function d1Batch(statements: D1Statement[]): Promise<D1QueryResult[]> {
  const endpoint = process.env.D1_GATEWAY_URL;
  const secret = process.env.D1_GATEWAY_SECRET;
  if (!endpoint || !secret || secret.length < 32) throw new DatabaseError();
  let url: URL;
  try {
    url = new URL(endpoint);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    throw new DatabaseError();
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ statements }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new DatabaseError(response.status === 409 ? 409 : 503);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results) || body.results.length !== statements.length) throw new DatabaseError();
    for (const result of body.results) {
      if (!result || !Array.isArray(result.results) || typeof result.meta?.changes !== "number") throw new DatabaseError();
    }
    return body.results as D1QueryResult[];
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError();
  }
}

export async function d1Query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: D1Value[] = [],
): Promise<T[]> {
  const [result] = await d1Batch([{ sql, params }]);
  return result.results as T[];
}
