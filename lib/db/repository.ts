import "server-only";
import { d1Batch, d1Query, type D1Statement, type D1Value } from "../cloudflare/d1";
import { COLLECTIONS, type Collection } from "../admin/collections";
import {
  collectionDefinition, decodeRow, validateId, validatePayload, validateSettings,
  ValidationError, type DbRow,
} from "./validation";
import type { SiteSettings } from "../settings";

export { ValidationError };
export type { DbRow };

const PUBLIC_ORDER: Record<string, string> = {
  products: "created_at", blog_posts: "date", pyqs: "year", gallery_items: "created_at",
  success_photos: "created_at", current_affairs_monthly: "created_at", current_affairs_daily: "date",
  resources: "created_at", syllabus_subjects: "questions", syllabus_downloads: "created_at",
  norcet_resources: "created_at", batches: "created_at",
};

function pagination(limit = 100, offset = 0) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new ValidationError("Invalid pagination.");
  return { limit, offset };
}

export async function listCollection(slug: string, options: { limit?: number; offset?: number } = {}): Promise<DbRow[]> {
  const collection = collectionDefinition(slug);
  const { limit, offset } = pagination(options.limit, options.offset);
  return (await d1Query(`SELECT * FROM ${collection.table} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [limit, offset])).map(decodeRow);
}

export async function getCollectionRow(slug: string, id: string): Promise<DbRow | null> {
  const collection = collectionDefinition(slug);
  validateId(id);
  const [row] = await d1Query(`SELECT * FROM ${collection.table} WHERE id = ? LIMIT ?`, [id, 1]);
  return row ? decodeRow(row) : null;
}

function isManagedAsset(value: string): boolean {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!base) return false;
  try {
    const target = new URL(value);
    const root = new URL(base);
    const prefix = root.pathname.replace(/\/$/, "") + "/";
    return target.origin === root.origin && decodeURIComponent(target.pathname).startsWith(decodeURIComponent(prefix));
  } catch { return false; }
}

function assetStatements(collection: Collection, id: string, values: Record<string, D1Value>): D1Statement[] {
  const statements: D1Statement[] = [];
  for (const field of collection.fields.filter((field) => ["file", "image"].includes(field.type))) {
    if (!Object.hasOwn(values, field.name)) continue;
    statements.push({ sql: "DELETE FROM asset_references WHERE collection_slug = ? AND row_id = ? AND field_name = ?", params: [collection.slug, id, field.name] });
    const url = values[field.name];
    if (typeof url === "string" && isManagedAsset(url)) {
      // Missing assets fail NOT NULL/FK checks; pending/deleting assets fail
      // the ready trigger. Both roll the entire content mutation back.
      statements.push({
        sql: "INSERT INTO asset_references (asset_id, collection_slug, row_id, field_name) VALUES ((SELECT id FROM assets WHERE public_url = ?), ?, ?, ?)",
        params: [url, collection.slug, id, field.name],
      });
    }
  }
  if (collection.table === "blog_posts" && Object.hasOwn(values, "content")) {
    statements.push({ sql: "DELETE FROM asset_references WHERE collection_slug = ? AND row_id = ? AND field_name LIKE ?", params: [collection.slug, id, "content:%"] });
    const urls = new Set<string>();
    for (const match of String(values.content).matchAll(/https:\/\/[^\s<>"')\]]+/gi)) {
      if (!isManagedAsset(match[0])) continue;
      const url = new URL(match[0]);
      url.search = "";
      url.hash = "";
      urls.add(url.toString());
    }
    if (urls.size > 20) throw new ValidationError("An article can reference at most 20 uploaded assets.");
    [...urls].forEach((url, index) => statements.push({
      sql: "INSERT INTO asset_references (asset_id, collection_slug, row_id, field_name) VALUES ((SELECT id FROM assets WHERE public_url = ?), ?, ?, ?)",
      params: [url, collection.slug, id, `content:${index}`],
    }));
  }
  return statements;
}

export async function createCollectionRow(slug: string, input: unknown): Promise<DbRow> {
  const collection = collectionDefinition(slug);
  const values = validatePayload(collection, input, true);
  const id = crypto.randomUUID();
  const columns = ["id", ...Object.keys(values)];
  const results = await d1Batch([
    { sql: `INSERT INTO ${collection.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`, params: [id, ...Object.values(values)] },
    ...assetStatements(collection, id, values),
  ]);
  return decodeRow(results[0].results[0]);
}

export async function updateCollectionRow(slug: string, id: string, input: unknown): Promise<DbRow | null> {
  const collection = collectionDefinition(slug);
  validateId(id);
  const values = validatePayload(collection, input);
  // Reference inserts additionally require that the content row still exists;
  // this preliminary check also gives a clean not-found response.
  if (!await getCollectionRow(slug, id)) return null;
  const refs = assetStatements(collection, id, values).map((statement) => statement.sql.startsWith("INSERT") ? {
    sql: statement.sql.replace("VALUES ((SELECT id FROM assets WHERE public_url = ?), ?, ?, ?)", `SELECT (SELECT id FROM assets WHERE public_url = ?), ?, ?, ? WHERE EXISTS (SELECT id FROM ${collection.table} WHERE id = ?)`),
    params: [...statement.params!, id],
  } : statement);
  const results = await d1Batch([
    { sql: `UPDATE ${collection.table} SET ${Object.keys(values).map((column) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ? RETURNING *`, params: [...Object.values(values), new Date().toISOString(), id] },
    ...refs,
  ]);
  return results[0].results[0] ? decodeRow(results[0].results[0]) : null;
}

export async function deleteCollectionRow(slug: string, id: string): Promise<DbRow | null> {
  const collection = collectionDefinition(slug);
  validateId(id);
  const results = await d1Batch([
    { sql: "DELETE FROM asset_references WHERE collection_slug = ? AND row_id = ?", params: [collection.slug, id] },
    { sql: `DELETE FROM ${collection.table} WHERE id = ? RETURNING *`, params: [id] },
  ]);
  return results[1].results[0] ? decodeRow(results[1].results[0]) : null;
}

export async function getCollectionCounts(): Promise<Record<string, { total: number; published: number }>> {
  const results = await d1Batch(COLLECTIONS.map((collection) => ({ sql: `SELECT COUNT(*) AS total, COALESCE(SUM(published), 0) AS published FROM ${collection.table}` })));
  return Object.fromEntries(COLLECTIONS.map((collection, index) => [collection.slug, { total: Number(results[index].results[0].total), published: Number(results[index].results[0].published) }]));
}

export async function getSettings(): Promise<Partial<SiteSettings>> {
  const [row] = await d1Query("SELECT data FROM site_settings WHERE id = ? LIMIT ?", [1, 1]);
  return row && typeof row.data === "string" ? validateSettings(JSON.parse(row.data)) : {};
}

export async function saveSettings(input: unknown): Promise<Partial<SiteSettings>> {
  const settings = validateSettings(input);
  // JSON patch preserves keys omitted by a partial update in a single write.
  const [row] = await d1Query("INSERT INTO site_settings (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = json_patch(site_settings.data, excluded.data), updated_at = excluded.updated_at RETURNING data", [1, JSON.stringify(settings), new Date().toISOString()]);
  return validateSettings(JSON.parse(String(row.data)));
}

export async function isAdmin(clerkUserId: string): Promise<boolean> {
  if (typeof clerkUserId !== "string" || !/^user_[A-Za-z0-9]{1,128}$/.test(clerkUserId)) return false;
  const rows = await d1Query("SELECT clerk_user_id FROM admins WHERE clerk_user_id = ? LIMIT ?", [clerkUserId, 1]);
  return rows.length === 1;
}

/** Internal published-only access; admin and membership queries never use a cache. */
export async function listPublishedRows(table: string, options: { limit?: number; offset?: number } = {}): Promise<DbRow[]> {
  const collection = collectionDefinition(table);
  const { limit, offset } = pagination(options.limit ?? 500, options.offset);
  const columns = ["id", ...collection.fields.map((field) => field.name).filter((field) => !(collection.table === "blog_posts" && field === "content"))];
  const order = PUBLIC_ORDER[collection.table];
  const direction = collection.table === "syllabus_downloads" ? "ASC" : "DESC";
  const rows = await d1Query(`SELECT ${columns.join(", ")} FROM ${collection.table} WHERE published = ? ORDER BY ${order} ${direction}, id ${direction} LIMIT ? OFFSET ?`, [1, limit, offset]);
  return rows.map((row) => decodeRow(collection.table === "blog_posts" ? { ...row, content: "" } : row));
}

export async function getPublishedPost(slug: string): Promise<DbRow | null> {
  const collection = collectionDefinition("blogs");
  const columns = ["id", ...collection.fields.map((field) => field.name)];
  const [row] = await d1Query(`SELECT ${columns.join(", ")} FROM blog_posts WHERE slug = ? AND published = ? LIMIT ?`, [slug, 1, 1]);
  return row ? decodeRow(row) : null;
}
