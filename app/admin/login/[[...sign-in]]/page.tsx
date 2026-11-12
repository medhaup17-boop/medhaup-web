import { SignIn } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/auth/config";

export default function AdminLogin() {
  if (!isClerkConfigured()) return null;
  return (
    <main className="grid min-h-dvh place-items-center bg-navy px-4 py-8">
      <div>
        <h1 className="mb-6 text-center font-heading text-2xl font-bold text-white">medhaup Admin</h1>
        <SignIn routing="path" path="/admin/login" fallbackRedirectUrl="/admin" forceRedirectUrl="/admin" />
      </div>
    </main>
  );
}
