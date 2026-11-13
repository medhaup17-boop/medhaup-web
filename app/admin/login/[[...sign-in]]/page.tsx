import { isAdminAuthConfigured } from "@/lib/auth/config";
import LoginForm from "../LoginForm";

export default function AdminLogin() {
  if (!isAdminAuthConfigured()) return null;
  return (
    <main className="grid min-h-dvh place-items-center bg-navy px-4 py-8">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center font-heading text-2xl font-bold text-white">medhaup Admin</h1>
        <LoginForm />
      </div>
    </main>
  );
}
