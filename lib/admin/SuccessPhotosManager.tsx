"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "@/components/ui/ContentImage";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Images,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { adminRequest, collectionPath, uploadAsset } from "@/lib/admin/api";

type PhotoAspect = "tall" | "wide" | "square";

type SuccessPhotoRow = {
  id: string;
  src: string;
  alt: string;
  aspect: PhotoAspect;
  published: boolean;
  created_at: string;
};

type UploadProgress = {
  completed: number;
  total: number;
};

const COLLECTION = "success-photos";

function fileAlt(fileName: string) {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Student success photo"
  );
}

function detectAspect(file: File): Promise<PhotoAspect> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();

    const finish = (aspect: PhotoAspect) => {
      URL.revokeObjectURL(objectUrl);
      resolve(aspect);
    };

    image.onload = () => {
      const ratio = image.naturalWidth / image.naturalHeight;
      if (ratio > 1.15) finish("wide");
      else if (ratio < 0.9) finish("tall");
      else finish("square");
    };
    image.onerror = () => finish("tall");
    image.src = objectUrl;
  });
}

export default function SuccessPhotosManager() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<SuccessPhotoRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [success, setSuccess] = useState("");

  const listPath = `${collectionPath(COLLECTION)}?limit=50&offset=${page * 50}`;
  const loadRows = useCallback(async () => {
    try {
      const data = await adminRequest<{ rows: SuccessPhotoRow[]; hasMore: boolean }>(listPath);
      setRows(data.rows);
      setHasMore(data.hasMore);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load photos.");
    } finally { setLoading(false); }
  }, [listPath]);

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<{ rows: SuccessPhotoRow[]; hasMore: boolean }>(listPath, { signal: controller.signal })
      .then((data) => { setRows(data.rows); setHasMore(data.hasMore); })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load photos."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [listPath]);

  const uploadFiles = async (selectedFiles: File[]) => {
    if (uploading || mutating) return;

    const files = selectedFiles.filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) {
      setError("Please select one or more image files.");
      return;
    }

    setUploading(true);
    setError("");
    setSuccess("");
    setProgress({ completed: 0, total: files.length });

    const failures: string[] = [];
    let uploadedCount = 0;

    for (const [index, file] of files.entries()) {
      let uploadedAssetId: string | null = null;

      try {
        const aspect = await detectAspect(file);
        const asset = await uploadAsset(COLLECTION, "src", file);
        uploadedAssetId = asset.assetId;
        await adminRequest(collectionPath(COLLECTION), {
          method: "POST",
          body: JSON.stringify({ src: asset.url, alt: fileAlt(file.name), aspect, published: true }),
        });
        uploadedAssetId = null;
        uploadedCount += 1;
      } catch (uploadError) {
        if (uploadedAssetId) await adminRequest(`/uploads/${encodeURIComponent(uploadedAssetId)}`, { method: "DELETE" }).catch(() => undefined);
        const message =
          uploadError instanceof Error ? uploadError.message : "Upload failed";
        failures.push(`${file.name}: ${message}`);
      } finally {
        setProgress({ completed: index + 1, total: files.length });
      }
    }

    await loadRows();
    setUploading(false);
    setProgress(null);

    if (uploadedCount > 0) {
      setSuccess(
        `${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} uploaded and published.`,
      );
    }
    if (failures.length > 0) {
      setError(
        `${failures.length} upload${failures.length === 1 ? "" : "s"} failed. ${failures.slice(0, 3).join(" | ")}`,
      );
    }
  };

  const togglePublished = async (row: SuccessPhotoRow) => {
    if (mutating || uploading) return;
    setMutating(true);
    setError("");
    try {
      const result = await adminRequest<{ warning?: string }>(collectionPath(COLLECTION, row.id), {
        method: "PATCH", body: JSON.stringify({ published: !row.published }),
      });
      setWarning(result.warning ?? "");
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, published: !item.published } : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not change publishing status.");
    } finally { setMutating(false); }
  };

  const removePhoto = async (row: SuccessPhotoRow) => {
    if (mutating || uploading || !confirm("Delete this success photo? This cannot be undone.")) return;
    setMutating(true);
    setError("");
    try {
      const result = await adminRequest<{ warning?: string }>(collectionPath(COLLECTION, row.id), { method: "DELETE" });
      setWarning(result.warning ?? "");
      await loadRows();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not delete photo.");
    } finally { setMutating(false); }
  };

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-navy">
            Success Wall Photos
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-navy/60">
            Upload several completed student artworks at once. New photos are
            published automatically and displayed first on the success wall.
          </p>
        </div>
        <Link
          href="/wall-of-success"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-xl text-sm font-semibold text-navy/60 transition-colors hover:text-orange"
        >
          View success wall <ExternalLink size={15} aria-hidden="true" />
        </Link>
      </div>

      <div
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
        className={`mt-6 rounded-2xl border-2 border-dashed p-5 text-center transition-colors sm:mt-7 sm:p-7 ${
          dragging
            ? "border-orange bg-orange/5"
            : "border-navy/15 bg-white hover:border-orange/60"
        }`}
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-orange/10 text-orange">
          {uploading ? (
            <Loader2 size={22} className="animate-spin" aria-hidden="true" />
          ) : (
            <UploadCloud size={22} aria-hidden="true" />
          )}
        </span>
        <h2 className="font-heading mt-4 font-bold text-navy">
          {uploading
            ? `Uploading ${progress?.completed ?? 0} of ${progress?.total ?? 0}`
            : "Add student photos"}
        </h2>
        <p className="mt-1 text-sm text-navy/50">
          Select multiple JPG, PNG, or WebP images from your device. You can
          also drag and drop them here on a computer.
        </p>
        <button
          type="button"
          disabled={uploading || mutating}
          onClick={() => inputRef.current?.click()}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-dark disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <Images size={17} aria-hidden="true" />
          Select multiple photos
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={uploading || mutating}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length > 0) void uploadFiles(files);
          }}
        />

        {progress && (
          <div className="mx-auto mt-5 h-1.5 max-w-sm overflow-hidden rounded-full bg-navy/8">
            <div
              className="h-full rounded-full bg-orange transition-[width] duration-300"
              style={{
                width: `${(progress.completed / progress.total) * 100}%`,
              }}
            />
          </div>
        )}
      </div>

      {success && (
        <p className="mt-4 flex items-start gap-2 break-words rounded-xl bg-green-50 px-4 py-3 text-sm font-medium leading-6 text-green-700">
          <CheckCircle2 size={17} aria-hidden="true" /> {success}
        </p>
      )}
      {warning && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{warning}</p>}
      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-700">
          <AlertCircle
            size={17}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {error}
        </p>
      )}

      <div className="mt-8 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-extrabold text-navy">
            Uploaded photos
          </h2>
          <p className="mt-0.5 text-xs text-navy/45">
            Newest photos are shown first.
          </p>
        </div>
        <span className="rounded-full bg-navy/7 px-3 py-1.5 text-xs font-bold text-navy/55">
          {rows.length} on this page
        </span>
      </div>

      {loading ? (
        <div className="mt-5 grid place-items-center rounded-2xl border border-navy/10 bg-white p-12 sm:p-16">
          <Loader2
            className="animate-spin text-navy/35"
            aria-label="Loading photos"
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-navy/10 bg-white p-8 text-center sm:p-12">
          <Images
            className="mx-auto text-navy/20"
            size={34}
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-navy/50">
            No success photos uploaded yet.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((row) => (
            <article
              key={row.id}
              className="overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-sm"
            >
              <div className="relative aspect-[4/5] bg-cream">
                <Image
                  src={row.src}
                  alt={row.alt || "Student success photo"}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  className="object-cover"
                />
                {!row.published && (
                  <span className="absolute left-2 top-2 rounded-full bg-navy/85 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                    Hidden
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1.5 p-2.5">
                <button
                  type="button"
                  disabled={mutating || uploading}
                  onClick={() => void togglePublished(row)}
                  className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                    row.published
                      ? "bg-green-50 text-green-700 hover:bg-green-100"
                      : "bg-navy/7 text-navy/55 hover:bg-navy/12"
                  }`}
                >
                  {row.published ? <Eye size={12} /> : <EyeOff size={12} />}
                  {row.published ? "Live" : "Hidden"}
                </button>
                <button
                  type="button"
                  aria-label="Delete photo"
                  disabled={mutating || uploading}
                  onClick={() => void removePhoto(row)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-navy/45 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="mt-5 flex items-center justify-between gap-3 text-sm">
        <button type="button" disabled={page === 0 || loading || uploading || mutating} onClick={() => { setLoading(true); setError(""); setPage((value) => value - 1); }} className="min-h-11 rounded-xl border border-navy/15 px-4 font-semibold disabled:opacity-40">Previous</button>
        <span className="text-navy/60">Page {page + 1}</span>
        <button type="button" disabled={!hasMore || loading || uploading || mutating} onClick={() => { setLoading(true); setError(""); setPage((value) => value + 1); }} className="min-h-11 rounded-xl border border-navy/15 px-4 font-semibold disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
