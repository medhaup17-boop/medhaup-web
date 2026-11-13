"use client";

import { useRef, useState } from "react";
import { Loader2, LogOut } from "lucide-react";

export default function SignOutButton({ variant = "button" }: { variant?: "button" | "navigation" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const navigation = variant === "navigation";

  async function signOut() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const data: { ok?: unknown; error?: unknown } = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        setError(typeof data.error === "string" && data.error ? data.error : "Unable to sign out. Please try again.");
        return;
      }
      // Discard cached admin routes after the server clears the session cookie.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/admin/login");
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div className={navigation ? "mt-3" : "mt-6"}>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={pending}
        aria-busy={pending}
        className={navigation
          ? "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-wait disabled:opacity-60"
          : "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange px-5 py-2 font-semibold text-white transition-colors hover:bg-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-wait disabled:opacity-60"}
      >
        {pending ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert" className={navigation ? "mt-2 px-3 text-sm leading-5 text-rose-200" : "mt-3 text-sm leading-6 text-red-700"}>{error}</p>}
    </div>
  );
}
