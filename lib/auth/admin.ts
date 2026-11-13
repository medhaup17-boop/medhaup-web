import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAdminAuthConfigured } from "./config";
import { ADMIN_COOKIE_NAME, ADMIN_USER_ID, verifyAdminSession } from "./session";

export class AdminAccessError extends Error {
  constructor(message: string, public readonly status: 401 | 403 | 503) {
    super(message);
    this.name = "AdminAccessError";
  }
}

/** Check the live, revocable session on every protected API/page request. */
export async function requireAdmin(): Promise<{ userId: string }> {
  if (!isAdminAuthConfigured()) {
    throw new AdminAccessError("Admin sign-in is not configured yet.", 503);
  }

  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!token) throw new AdminAccessError("Please sign in to continue.", 401);
  let allowed: boolean;
  try {
    allowed = await verifyAdminSession(token);
  } catch {
    throw new AdminAccessError("Admin access is temporarily unavailable. Please try again.", 503);
  }
  if (!allowed) {
    throw new AdminAccessError("Your session has expired. Please sign in again.", 401);
  }
  return { userId: ADMIN_USER_ID };
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
