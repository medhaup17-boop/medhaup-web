import { requireAdmin } from "@/lib/auth/admin";
import { discardUpload } from "@/lib/storage/r2";
import { adminError, adminJson, assertSameOrigin } from "../../_utils";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { userId } = await requireAdmin();
    const { id } = await params;
    await discardUpload(id, userId);
    return adminJson({ ok: true });
  } catch (error) { return adminError(error); }
}
