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

type DatabaseFailure =
  | "missing_gateway_url" | "missing_gateway_secret" | "invalid_gateway_secret"
  | "invalid_gateway_url" | "gateway_unauthorized" | "gateway_endpoint_not_found"
  | "gateway_request_rejected" | "gateway_unavailable" | "gateway_http_error"
  | "invalid_gateway_response" | "gateway_timeout" | "gateway_network_error";

const NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function databaseFailure(reason: DatabaseFailure, details?: { httpStatus?: number; networkCode?: string }): DatabaseError {
  // Vercel runtime logs identify the failing stage without exposing URLs,
  // credentials, SQL, provider bodies, or raw exception messages to anyone.
  console.error(`[d1] ${reason}`, details ?? {});
  return new DatabaseError();
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
}

/** Never expose this gateway or its secret through browser bundles. */
export async function d1Batch(statements: D1Statement[]): Promise<D1QueryResult[]> {
  const endpoint = process.env.D1_GATEWAY_URL?.trim();
  const secret = process.env.D1_GATEWAY_SECRET;
  if (!endpoint) throw databaseFailure("missing_gateway_url");
  if (!secret) throw databaseFailure("missing_gateway_secret");
  // Never trim or otherwise rewrite a shared secret: the Worker must receive
  // the exact configured identity. Newlines cannot be sent in an HTTP header.
  if (secret.length < 32 || /[\r\n]/.test(secret)) throw databaseFailure("invalid_gateway_secret");
  let url: URL;
  try {
    url = new URL(endpoint);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    throw databaseFailure("invalid_gateway_url");
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
    if (!response.ok) {
      if (response.status === 409) throw new DatabaseError(409);
      const reason: DatabaseFailure = response.status === 401 || response.status === 403 ? "gateway_unauthorized"
        : response.status === 404 ? "gateway_endpoint_not_found"
        : response.status === 400 || response.status === 413 || response.status === 415 ? "gateway_request_rejected"
        : response.status >= 500 ? "gateway_unavailable" : "gateway_http_error";
      throw databaseFailure(reason, { httpStatus: response.status });
    }
    let body: unknown;
    try { body = await response.json(); }
    catch (error) { throw databaseFailure(isTimeout(error) ? "gateway_timeout" : "invalid_gateway_response"); }
    if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results) || body.results.length !== statements.length) throw databaseFailure("invalid_gateway_response");
    for (const result of body.results) {
      if (!result || !Array.isArray(result.results) || typeof result.meta?.changes !== "number") throw databaseFailure("invalid_gateway_response");
    }
    return body.results as D1QueryResult[];
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    const cause = error instanceof Error ? error.cause : undefined;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    const networkCode = typeof code === "string" && NETWORK_CODES.has(code) ? code : undefined;
    throw databaseFailure(isTimeout(error) ? "gateway_timeout" : "gateway_network_error", networkCode ? { networkCode } : undefined);
  }
}

export async function d1Query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: D1Value[] = [],
): Promise<T[]> {
  const [result] = await d1Batch([{ sql, params }]);
  return result.results as T[];
}
