import "server-only";
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { d1Query } from "@/lib/cloudflare/d1";
import { getCollection } from "@/lib/admin/collections";
import {
  attachmentDisposition,
  StorageError,
  UPLOAD_MAX_AGE_MS,
  UPLOAD_TTL_SECONDS,
  uploadFieldKind,
  validateFileSignature,
  validateUploadRequest,
} from "./validation";

type Asset = Record<string, unknown> & {
  id: string;
  object_key: string;
  staging_key: string;
  public_url: string;
  original_name: string;
  content_type: string;
  size: number;
  owner_id: string;
  status: "pending" | "processing" | "ready" | "deleting";
  created_at: string;
  updated_at: string;
};

function storageConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const stagingBucket = process.env.R2_STAGING_BUCKET;
  const publicBucket = process.env.R2_PUBLIC_BUCKET;
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !stagingBucket || !publicBucket || !publicUrl) {
    throw new StorageError("File storage is not configured yet.", 503);
  }
  let base: URL;
  try { base = new URL(publicUrl); } catch { throw new StorageError("The public asset URL is not configured correctly.", 503); }
  if (!/^[a-f0-9]{32}$/i.test(accountId) || base.protocol !== "https:" || base.username || base.password || base.search || base.hash || stagingBucket === publicBucket) {
    throw new StorageError("File storage configuration is invalid. Use separate staging and public buckets.", 503);
  }
  return {
    stagingBucket,
    publicBucket,
    publicUrl: base.toString().replace(/\/$/, ""),
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
}

function assertId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new StorageError("Upload not found.", 404);
  }
}

async function ownedAsset(id: string, userId: string) {
  assertId(id);
  const [asset] = await d1Query<Asset>("SELECT * FROM assets WHERE id = ? AND owner_id = ? LIMIT 1", [id, userId]);
  if (!asset) throw new StorageError("Upload not found.", 404);
  return asset;
}

export async function beginUpload(input: unknown, userId: string) {
  const file = validateUploadRequest(input);
  const config = storageConfig();
  const [{ total }] = await d1Query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM assets WHERE owner_id = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')",
    [userId],
  );
  if (total >= 100) throw new StorageError("The hourly upload limit has been reached. Please try again later.", 429);
  const id = crypto.randomUUID();
  const finalName = file.contentType.startsWith("image/") ? `${file.safeName.replace(/\.[^.]+$/, "")}.webp` : file.safeName;
  const objectKey = `assets/${id}/${finalName}`;
  const stagingKey = `pending/${id}`;
  const publicUrl = `${config.publicUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const url = await getSignedUrl(config.client, new PutObjectCommand({
    Bucket: config.stagingBucket,
    Key: stagingKey,
    ContentType: file.contentType,
    ContentLength: file.size,
  }), { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) });
  await d1Query(
    "INSERT INTO assets (id, object_key, staging_key, public_url, original_name, content_type, size, owner_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    [id, objectKey, stagingKey, publicUrl, file.fileName, file.contentType, file.size, userId],
  );
  return { uploadId: id, url, headers: { "Content-Type": file.contentType } };
}

export async function completeUpload(id: string, userId: string) {
  const asset = await ownedAsset(id, userId);
  if (asset.status === "ready") return { assetId: asset.id, url: asset.public_url };
  if (asset.status !== "pending") throw new StorageError("This upload is already being processed. Please retry shortly.", 409);
  if (Date.now() - Date.parse(asset.created_at) > UPLOAD_MAX_AGE_MS) throw new StorageError("This upload expired. Please upload the file again.", 409);
  const config = storageConfig();
  const claimed = await d1Query<Asset>(
    "UPDATE assets SET status = 'processing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending' RETURNING *", [id],
  );
  if (!claimed.length) throw new StorageError("This upload is already being processed. Please retry shortly.", 409);
  let promoted = false;
  try {
    const object = await config.client.send(new HeadObjectCommand({ Bucket: config.stagingBucket, Key: asset.staging_key }));
    if (object.ContentLength !== asset.size || object.ContentType !== asset.content_type || !object.ETag) {
      throw new StorageError("Uploaded file size or type did not match the selected file.", 415);
    }
    const readRange = async (range: string) => {
      const response = await config.client.send(new GetObjectCommand({
        Bucket: config.stagingBucket, Key: asset.staging_key, Range: range, IfMatch: object.ETag,
      }));
      if (!response.Body || (response.ContentLength ?? Infinity) > 1024) throw new StorageError("Could not validate the uploaded file.", 415);
      return response.Body.transformToByteArray();
    };
    const head = await readRange(`bytes=0-${Math.min(asset.size - 1, 31)}`);
    const tail = asset.content_type === "application/pdf"
      ? await readRange(`bytes=${Math.max(0, asset.size - 1024)}-${asset.size - 1}`)
      : undefined;
    validateFileSignature(asset.content_type, head, tail);
    let finalSize = asset.size;
    let finalType = asset.content_type;
    if (asset.content_type.startsWith("image/")) {
      const source = await config.client.send(new GetObjectCommand({
        Bucket: config.stagingBucket, Key: asset.staging_key, IfMatch: object.ETag,
      }));
      if (!source.Body || source.ContentLength !== asset.size) throw new StorageError("Could not validate the uploaded image.", 415);
      const input = await source.Body.transformToByteArray();
      if (input.byteLength !== asset.size) throw new StorageError("The uploaded image is incomplete.", 415);
      let optimized: Buffer;
      try {
        optimized = await sharp(input, { limitInputPixels: 40_000_000, failOn: "warning" })
          .rotate()
          .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
      } catch { throw new StorageError("The image could not be decoded. Use an image below 40 megapixels.", 415); }
      finalSize = optimized.byteLength;
      finalType = "image/webp";
      await config.client.send(new PutObjectCommand({
        Bucket: config.publicBucket, Key: asset.object_key, Body: optimized,
        ContentType: finalType, ContentLength: finalSize, ContentDisposition: "inline",
        CacheControl: "public, max-age=31536000, immutable",
      }));
    } else {
      // Pin promotion to precisely the bytes validated above, even if the signed
      // PUT is replayed against the staging key before this copy executes.
      await config.client.send(new CopyObjectCommand({
        Bucket: config.publicBucket,
        Key: asset.object_key,
        CopySource: `${config.stagingBucket}/${asset.staging_key.split("/").map(encodeURIComponent).join("/")}`,
        CopySourceIfMatch: object.ETag,
        MetadataDirective: "REPLACE",
        ContentType: finalType,
        ContentDisposition: attachmentDisposition(asset.original_name),
        CacheControl: "public, max-age=31536000, immutable",
      }));
    }
    promoted = true;
    await d1Query("UPDATE assets SET status = 'ready', content_type = ?, size = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'processing'", [finalType, finalSize, id]);
  } catch (error) {
    // A DB failure can have an uncertain outcome. Never remove an object after
    // promotion here; the cleanup workflow will reconcile its metadata safely.
    if (!promoted) await d1Query("UPDATE assets SET status = 'pending' WHERE id = ? AND status = 'processing'", [id]).catch(() => {});
    if (error instanceof StorageError) throw error;
    throw new StorageError("The upload could not be completed. Please retry or remove it and upload again.", 409);
  }
  await config.client.send(new DeleteObjectCommand({ Bucket: config.stagingBucket, Key: asset.staging_key })).catch(() => {});
  return { assetId: asset.id, url: asset.public_url };
}

function mediaFields(slug: string) {
  if (slug === "success-photos") return [{ name: "src", type: "image" }];
  return getCollection(slug)?.fields.filter((field) => field.type === "image" || field.type === "file") ?? [];
}

/** URLs remain in content rows for compatibility, while managed files use asset IDs for ownership/deletion. */
export async function validateAssetReferences(slug: string, input: Record<string, unknown>) {
  for (const field of mediaFields(slug)) {
    const url = input[field.name];
    if (url === undefined || url === null || url === "") continue;
    if (typeof url !== "string") throw new StorageError("Invalid file URL.");
    // Local bundled resources and external approved HTTPS URLs remain usable.
    if (/^\/(?!\/)[^\s\\]*$/.test(url)) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new StorageError("File links must use HTTPS or a local resource path."); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new StorageError("File links must use HTTPS.");
    const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, "");
    if (field.type === "image") {
      const allowed = new Set(["https://ik.imagekit.io", "https://i.pravatar.cc"]);
      if (publicBase) allowed.add(new URL(publicBase).origin);
      if (!allowed.has(parsed.origin)) throw new StorageError("Upload this image or use an approved image host.");
    }
    const [asset] = await d1Query<Asset>("SELECT * FROM assets WHERE public_url = ? LIMIT 1", [url]);
    if (!asset && publicBase) {
      const base = new URL(publicBase);
      const prefix = `${base.pathname.replace(/\/$/, "")}/`;
      if (parsed.origin === base.origin && (parsed.pathname === base.pathname || parsed.pathname.startsWith(prefix))) {
        throw new StorageError("Choose a completed upload for this file.");
      }
    }
    if (asset && (asset.status !== "ready" || (uploadFieldKind(slug, field.name) === "file") !== (asset.content_type === "application/pdf"))) {
      throw new StorageError("This upload is not ready or has the wrong file type.");
    }
  }
}

async function deleteUnreferencedAsset(asset: Asset) {
  const config = storageConfig();
  // A ready-file reference can only be created while status remains ready;
  // the DB trigger and this claim close the save/delete race.
  const claim = await d1Query<Asset>(
    "UPDATE assets SET status = 'deleting', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND (status IN ('pending','ready','deleting') OR (status = 'processing' AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))) AND NOT EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id) RETURNING *",
    [asset.id],
  );
  if (!claim.length) return false;
  await config.client.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: asset.object_key }));
  await config.client.send(new DeleteObjectCommand({ Bucket: config.stagingBucket, Key: asset.staging_key }));
  await d1Query("DELETE FROM assets WHERE id = ? AND status = 'deleting' AND NOT EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id)", [asset.id]);
  return true;
}

export async function discardUpload(id: string, userId: string) {
  const asset = await ownedAsset(id, userId);
  if (asset.status === "processing" && Date.now() - Date.parse(asset.updated_at) < UPLOAD_MAX_AGE_MS) {
    throw new StorageError("This upload is being completed. Please retry shortly.", 409);
  }
  if (!await deleteUnreferencedAsset(asset)) throw new StorageError("This file is used by saved content and cannot be discarded.", 409);
}

export async function cleanupRecordAssets(row: Record<string, unknown>) {
  let deleted = 0;
  let failed = 0;
  const configuredBase = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!configuredBase) return { deleted, failed };
  const base = new URL(configuredBase);
  const prefix = `${base.pathname.replace(/\/$/, "")}/`;
  const urls = new Set<string>();
  for (const value of Object.values(row)) {
    if (typeof value !== "string") continue;
    // Include links embedded in article copy, matching repository reference
    // tracking. Only exact assets-table matches can ever delete an R2 object.
    for (const match of value.matchAll(/https:\/\/[^\s<>"')\]]+/gi)) {
      try {
        const parsed = new URL(match[0]);
        if (parsed.origin !== base.origin || !parsed.pathname.startsWith(prefix)) continue;
        parsed.search = "";
        parsed.hash = "";
        urls.add(parsed.toString());
      } catch { /* Content can contain ordinary text that resembles a URL. */ }
    }
  }
  for (const url of urls) {
    try {
      const [asset] = await d1Query<Asset>("SELECT * FROM assets WHERE public_url = ? LIMIT 1", [url]);
      if (asset && await deleteUnreferencedAsset(asset)) deleted++;
    } catch { failed++; }
  }
  return { deleted, failed };
}

/** Manual maintenance endpoint: call periodically from the admin, without paid schedulers. */
export async function cleanupAbandonedUploads() {
  const assets = await d1Query<Asset>(
    "SELECT * FROM assets WHERE (status IN ('pending','ready','deleting') OR (status = 'processing' AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))) AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') AND NOT EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id) LIMIT 50",
  );
  let deleted = 0;
  let failed = 0;
  for (const asset of assets) {
    try { if (await deleteUnreferencedAsset(asset)) deleted++; } catch { failed++; }
  }
  return { deleted, failed };
}
