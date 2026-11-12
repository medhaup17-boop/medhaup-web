import { COLLECTIONS, type Collection, type Field } from "../admin/collections";
import { SITE_DEFAULTS, type SiteSettings } from "../settings";
import type { D1Value } from "../cloudflare/d1";

export type DbRow = Record<string, unknown>;
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

const SUCCESS_FIELDS: Field[] = [
  { name: "src", label: "Photo", type: "image", required: true },
  { name: "alt", label: "Alt text", type: "text", required: true },
  { name: "aspect", label: "Shape", type: "select", options: ["tall", "wide", "square"] },
];

export function collectionDefinition(value: string): Collection {
  const collection = COLLECTIONS.find((item) => item.slug === value || item.table === value);
  if (!collection) throw new ValidationError("Unknown content collection.");
  return collection.manager === "success-photos" ? { ...collection, fields: SUCCESS_FIELDS } : collection;
}

export function validateId(value: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ValidationError("Invalid record ID.");
  return value;
}

export function validSlug(value: string): boolean {
  return value.length > 0 && value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Expected a content object.");
  return value as Record<string, unknown>;
}

export function validAssetUrl(value: string): boolean {
  if (!value || value.length > 2048 || /[\x00-\x20\\]/.test(value)) return false;
  if (value.startsWith("/resources/")) return /^\/resources\/[a-z0-9/_.-]+$/i.test(value) && !value.split("/").includes("..");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch { return false; }
}

function fieldValue(field: Field, value: unknown): D1Value {
  const fail = (message: string): never => { throw new ValidationError(`${field.label}: ${message}`); };
  if (field.type === "boolean") {
    if (typeof value !== "boolean") return fail("must be true or false.");
    return value ? 1 : 0;
  }
  if (field.type === "number") {
    if (value === null || value === "") {
      if (field.required) return fail("is required.");
      return field.name === "mrp" ? null : 0;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) return fail("must be a valid non-negative number.");
    if (!["price", "mrp"].includes(field.name) && !Number.isInteger(value)) return fail("must be a whole number.");
    if (field.name === "year" && (value < 1900 || value > 2200)) return fail("must be between 1900 and 2200.");
    return value;
  }
  if (field.type === "tags") {
    if (!Array.isArray(value) || value.length > 30 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 80)) return fail("must contain at most 30 short tags.");
    return JSON.stringify([...new Set(value.map((item: string) => item.trim()))]);
  }
  if (value === null && !field.required) {
    if (["cover", "answer_key_url"].includes(field.name)) return null;
    if (field.type === "date") return new Date().toISOString().slice(0, 10);
    if (field.type === "select") return field.options?.[0] ?? "";
    return "";
  }
  if (typeof value !== "string") return fail("must be text.");
  const text = value.trim();
  const max = field.type === "paragraphs" ? 80_000 : field.type === "textarea" ? 8_000 : 2_048;
  if (text.length > max || text.includes("\0")) return fail(`must be at most ${max} characters.`);
  if (field.required && !text) return fail("is required.");
  if (field.type === "select" && !field.options?.includes(text)) return fail("choose one of the available options.");
  if (field.type === "date") {
    if (!text && !field.required) return new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) return fail("must be a valid date.");
  }
  if (["file", "image"].includes(field.type) && text && !validAssetUrl(text)) return fail("must be a valid HTTPS asset URL.");
  if (["slug", "sid"].includes(field.name) && !validSlug(text)) return fail("use lowercase letters, numbers and single hyphens.");
  return text || (["cover", "answer_key_url"].includes(field.name) ? null : "");
}

export function validatePayload(collection: Collection, input: unknown, creating = false): Record<string, D1Value> {
  const values = { ...record(input) };
  const fields = [...collection.fields, { name: "published", label: "Published", type: "boolean" as const }];
  const allowed = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new ValidationError(`Field '${key}' cannot be changed.`);
  if (collection.table === "blog_posts" && (creating || Object.hasOwn(values, "slug")) && !values.slug) {
    values.slug = typeof values.title === "string" ? values.title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-") : "";
  }
  const payload: Record<string, D1Value> = {};
  for (const field of fields) {
    if (Object.hasOwn(values, field.name)) payload[field.name] = fieldValue(field, values[field.name]);
    else if (creating && field.required) throw new ValidationError(`${field.label} is required.`);
  }
  if (!Object.keys(payload).length) throw new ValidationError("No fields were provided.");
  return payload;
}

export function decodeRow(row: DbRow): DbRow {
  const result = { ...row };
  for (const field of ["published", "is_new", "in_stock"]) if (Object.hasOwn(result, field)) result[field] = result[field] === 1 || result[field] === true;
  if (typeof result.tags === "string") {
    const tags: unknown = JSON.parse(result.tags);
    result.tags = Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  }
  return result;
}

export function validateSettings(input: unknown): Partial<SiteSettings> {
  const values = record(input);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(SITE_DEFAULTS, key) || typeof value !== "string" || value.length > 2048 || /[\x00\r\n]/.test(value)) throw new ValidationError("Invalid site setting.");
    const text = value.trim();
    if (key.endsWith("Url") && text && (!/^https:\/\//i.test(text) || !validAssetUrl(text))) throw new ValidationError("Social links must use HTTPS.");
    if (["phone", "whatsappNumber"].includes(key) && text && !/^\d{6,16}$/.test(text)) throw new ValidationError("Phone numbers must contain 6 to 16 digits.");
    if (key === "email" && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new ValidationError("Enter a valid email address.");
    output[key] = text;
  }
  return output;
}
