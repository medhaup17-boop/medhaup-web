import { after } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { getCollection } from "@/lib/admin/collections";
import { deleteCollectionRow, getCollectionRow, updateCollectionRow } from "@/lib/db/repository";
import { cleanupRecordAssets, validateAssetReferences } from "@/lib/storage/assets";
import { adminError, adminJson, ApiError, assertSameOrigin, invalidateContent, readJson } from "../../../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string; id: string }> };

function cleanupAfterResponse(row: Record<string, unknown>) {
  // Content and its references are already committed. R2 housekeeping must
  // not keep a deleted item visible while storage requests finish. Next keeps
  // this task alive after the response; dashboard cleanup retries failures.
  after(async () => {
    try {
      const result = await cleanupRecordAssets(row);
      if (result.failed > 0) console.error("[admin] Unused file cleanup needs another attempt.");
    } catch {
      console.error("[admin] Unused file cleanup could not finish.");
    }
  });
}

export async function PATCH(request: Request, context: Context) {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const { slug, id } = await context.params;
    if (!getCollection(slug)) throw new ApiError("Collection not found.", 404);
    const previous = await getCollectionRow(slug, id);
    if (!previous) throw new ApiError("Item not found.", 404);
    const payload = await readJson(request);
    await validateAssetReferences(slug, payload);
    const row = await updateCollectionRow(slug, id, payload);
    if (!row) throw new ApiError("Item not found.", 404);
    invalidateContent();
    cleanupAfterResponse(previous);
    return adminJson({ row });
  } catch (error) {
    return adminError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const { slug, id } = await context.params;
    if (!getCollection(slug)) throw new ApiError("Collection not found.", 404);
    const row = await deleteCollectionRow(slug, id);
    if (!row) throw new ApiError("Item not found.", 404);
    invalidateContent();
    cleanupAfterResponse(row);
    return adminJson({ deleted: true });
  } catch (error) {
    return adminError(error);
  }
}
