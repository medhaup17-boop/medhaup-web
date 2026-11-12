"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminRequest } from "@/lib/admin/api";

type Stat = { slug: string; title: string; total: number; published: number };

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stat[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<{ stats: Stat[] }>("/stats", { signal: controller.signal })
      .then((data) => setStats(data.stats))
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load dashboard."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const cleanUploads = async () => {
    if (cleaning || !confirm("Remove old uploads that are not attached to any saved item?")) return;
    setCleaning(true);
    setCleanupStatus("");
    setError("");
    try {
      const result = await adminRequest<{ deleted: number; failed: number }>("/uploads/cleanup", { method: "POST" });
      setCleanupStatus(`Removed ${result.deleted} unused upload${result.deleted === 1 ? "" : "s"}.${result.failed ? ` ${result.failed} could not be removed; please retry.` : ""}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not clean up uploads.");
    } finally { setCleaning(false); }
  };

  return (
    <div>
      <h1 className="font-heading text-2xl font-extrabold text-navy">
        Dashboard
      </h1>
      <p className="mt-1 text-sm text-navy/60">
        Manage the content currently published across the website.
      </p>
      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-4 text-sm text-navy/60">Loading dashboard...</p>}
      <div className="mt-6 grid gap-4 sm:mt-8 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((s) => (
          <Link
            key={s.slug}
            href={`/admin/${s.slug}`}
            className="min-w-0 rounded-2xl border border-navy/10 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5"
          >
            <p className="text-sm font-semibold text-navy/60">{s.title}</p>
            <p className="font-heading mt-2 break-words text-3xl font-extrabold text-navy">
              {s.published}
              <span className="text-base font-semibold text-navy/40">
                {" "}
                / {s.total} live
              </span>
            </p>
            {s.published === 0 && (
              <span className="mt-2 inline-block rounded-full bg-orange/10 px-2.5 py-1 text-[11px] font-bold text-orange">
                SHOWING COMING SOON
              </span>
            )}
          </Link>
        ))}
      </div>
      <section className="mt-8 rounded-2xl border border-navy/10 bg-white p-5">
        <h2 className="font-heading font-bold text-navy">File storage</h2>
        <p className="mt-2 text-sm leading-6 text-navy/60">Remove old uploads that were never attached to a saved item to free storage space.</p>
        <button type="button" onClick={() => void cleanUploads()} disabled={cleaning} className="mt-4 min-h-11 rounded-xl border border-navy/15 px-4 text-sm font-semibold text-navy disabled:opacity-50">{cleaning ? "Cleaning up..." : "Clean up unused uploads"}</button>
        {cleanupStatus && <p role="status" className="mt-3 text-sm text-navy/70">{cleanupStatus}</p>}
      </section>
    </div>
  );
}
