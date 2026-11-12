import { requireAdmin } from "@/lib/auth/admin";
import { cleanupAbandonedUploads } from "@/lib/storage/r2";
import { adminError, adminJson, assertSameOrigin } from "../../_utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin();
    return adminJson(await cleanupAbandonedUploads());
  } catch (error) { return adminError(error); }
}
