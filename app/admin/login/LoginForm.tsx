"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

function signInError(response: Response, data: { error?: unknown }) {
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(seconds) && seconds > 0) {
      const minutes = Math.ceil(seconds / 60);
      return `Too many sign-in attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
  }
  return typeof data.error === "string" && data.error
    ? data.error
    : "Unable to sign in. Please try again.";
}

export default function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "") }),
        cache: "no-store",
      });
      const data: { ok?: unknown; error?: unknown } = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        setError(signInError(response, data));
        return;
      }
      // Load a fresh document after the server changes the authentication cookie.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/admin");
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="admin-sign-in-heading" className="rounded-2xl bg-white p-6 shadow-xl sm:p-8">
      <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-orange/10 text-orange">
        <LockKeyhole size={22} aria-hidden="true" />
      </span>
      <h2 id="admin-sign-in-heading" className="font-heading text-xl font-bold text-navy">Sign in</h2>
      <p className="mt-2 text-sm leading-6 text-navy/60">Enter your administrator email and password.</p>

      <form action="/api/admin/auth/login" method="post" onSubmit={submit} aria-busy={pending} className="mt-6">
        <fieldset disabled={pending} className="space-y-5">
          <legend className="sr-only">Administrator credentials</legend>
          <div>
            <label htmlFor="admin-email" className="block text-sm font-semibold text-navy">Email address</label>
            <input
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
              aria-describedby={error ? "admin-sign-in-error" : undefined}
              className="mt-2 min-h-12 w-full rounded-xl border border-navy/20 bg-white px-3 text-base text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/20 disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-sm font-semibold text-navy">Password</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-describedby={error ? "admin-sign-in-error" : undefined}
              className="mt-2 min-h-12 w-full rounded-xl border border-navy/20 bg-white px-3 text-base text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/20 disabled:opacity-60"
            />
          </div>
          {error && <p id="admin-sign-in-error" role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700">{error}</p>}
          <button type="submit" disabled={pending} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-wait disabled:opacity-60">
            {pending && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
