import { ClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isClerkConfigured()) {
    return (
      <main className="grid min-h-dvh place-items-center bg-cream px-4">
        <section className="max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center">
          <h1 className="font-heading text-xl font-bold text-navy">Admin setup pending</h1>
          <p className="mt-3 text-sm leading-6 text-navy/70">Administrator sign-in is not available yet. Contact the website owner to finish setup.</p>
        </section>
      </main>
    );
  }
  return (
    <ClerkProvider signInUrl="/admin/login" signInFallbackRedirectUrl="/admin" afterSignOutUrl="/admin/login">
      {children}
    </ClerkProvider>
  );
}
