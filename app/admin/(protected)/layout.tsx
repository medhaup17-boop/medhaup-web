import { SignOutButton } from "@clerk/nextjs";
import { AdminAccessError, requireAdminPage } from "@/lib/auth/admin";
import { isClerkConfigured } from "@/lib/auth/config";
import AdminShell from "../AdminShell";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  if (!isClerkConfigured()) return null;

  try {
    await requireAdminPage();
  } catch (error) {
    if (!(error instanceof AdminAccessError)) throw error;
    return (
      <main className="grid min-h-dvh place-items-center bg-cream px-4">
        <section className="max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center">
          <h1 className="font-heading text-xl font-bold text-navy">Admin access unavailable</h1>
          <p role="alert" className="mt-3 text-sm text-navy/70">{error.message}</p>
          <SignOutButton redirectUrl="/admin/login">
            <button className="mt-6 min-h-11 rounded-xl bg-orange px-5 py-2 font-semibold text-white">Sign out</button>
          </SignOutButton>
        </section>
      </main>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
