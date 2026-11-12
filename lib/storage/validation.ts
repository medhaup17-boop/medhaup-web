import { getCollection } from "@/lib/admin/collections";

export class StorageError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 413 | 415 | 429 | 503 = 400) {
    super(message);
    this.name = "StorageError";
  }
}

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 300;
export const UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

const TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
};

export function uploadFieldKind(collection: string, field: string): "image" | "file" {
  if (collection === "success-photos" && field === "src") return "image";
  const definition = getCollection(collection)?.fields.find((item) => item.name === field);
  if (!definition || (definition.type !== "image" && definition.type !== "file")) {
    throw new StorageError("This collection does not accept uploads in that field.");
  }
  return definition.type;
}

export function validateUploadRequest(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new StorageError("Invalid upload request.");
  }
  const value = input as Record<string, unknown>;
  const { collection, field, fileName, size } = value;
  if (typeof collection !== "string" || typeof field !== "string" || typeof fileName !== "string" || !fileName.trim() || fileName.length > 180) {
    throw new StorageError("Choose a file with a name of at most 180 characters.");
  }
  if (/[\x00-\x1f\x7f/\\]/.test(fileName)) throw new StorageError("The file name contains unsupported characters.");
  const kind = uploadFieldKind(collection, field);
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  // Some browsers omit PDF MIME metadata. The bytes are checked again after upload.
  const contentType = value.contentType === "" && extension === "pdf"
    ? "application/pdf"
    : value.contentType;
  if (typeof contentType !== "string" || !Object.hasOwn(TYPES, contentType) || !TYPES[contentType].includes(extension)) {
    throw new StorageError("Use a PDF, JPEG, PNG, WebP, or GIF file with a matching extension.", 415);
  }
  if ((kind === "file") !== (contentType === "application/pdf")) {
    throw new StorageError(kind === "file" ? "This field requires a PDF." : "This field requires an image.", 415);
  }
  const maximum = kind === "image" ? IMAGE_MAX_BYTES : PDF_MAX_BYTES;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > maximum) {
    throw new StorageError(`The maximum ${kind === "image" ? "image" : "PDF"} size is ${maximum / 1024 / 1024} MB.`, 413);
  }
  const safeName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || `upload.${extension}`;
  return { collection, field, fileName: fileName.trim(), safeName, contentType, size };
}

/** Check signatures on bytes fetched from R2, never the client-provided MIME alone. */
export function validateFileSignature(contentType: string, head: Uint8Array, tail?: Uint8Array) {
  const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
  let valid = false;
  switch (contentType) {
    case "application/pdf":
      valid = /^%PDF-\d\.\d/.test(text(head)) && !!tail && /%%EOF[\s\x00]*$/.test(text(tail));
      break;
    case "image/jpeg":
      valid = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      break;
    case "image/png":
      valid = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => head[i] === byte);
      break;
    case "image/gif":
      valid = /^GIF8[79]a/.test(text(head));
      break;
    case "image/webp":
      valid = text(head.slice(0, 4)) === "RIFF" && text(head.slice(8, 12)) === "WEBP";
      break;
  }
  if (!valid) throw new StorageError("The uploaded bytes do not match a supported, complete file. Please choose another file.", 415);
}

export function attachmentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
