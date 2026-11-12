import "server-only";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/db/repository";
import { isClerkConfigured } from "./config";

export class AdminAccessError extends Error {
  constructor(message: string, public readonly status: 401 | 403 | 503) {
    super(message);
    this.name = "AdminAccessError";
  }
}

/** Every admin API/action calls this: a Clerk account alone is not CMS access. */
export async function requireAdmin(): Promise<{ userId: string }> {
  if (!isClerkConfigured()) {
    throw new AdminAccessError("Admin sign-in is not configured yet.", 503);
  }

  let userId: string | null;
  try {
    ({ userId } = await auth({ acceptsToken: "session_token" }));
  } catch {
    throw new AdminAccessError("Unable to verify your session. Please try again.", 503);
  }
  if (!userId) throw new AdminAccessError("Please sign in to continue.", 401);

  let allowed: boolean;
  try {
    allowed = await isAdmin(userId);
  } catch {
    throw new AdminAccessError("Admin access is temporarily unavailable. Please try again.", 503);
  }
  if (!allowed) {
    throw new AdminAccessError("Your account does not have administrator access.", 403);
  }
  return { userId };
}

export async function requireAdminPage(): Promise<{ userId: string }> {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError && error.status === 401) {
      redirect("/admin/login");
    }
    throw error;
  }
}
