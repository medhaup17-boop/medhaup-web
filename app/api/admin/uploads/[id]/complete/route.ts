import { requireAdmin } from "@/lib/auth/admin";
import { completeUpload } from "@/lib/storage/r2";
import { adminError, adminJson, assertSameOrigin } from "../../../_utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { userId } = await requireAdmin();
    const { id } = await params;
    return adminJson(await completeUpload(id, userId));
  } catch (error) { return adminError(error); }
}
