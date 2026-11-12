import { requireAdmin } from "@/lib/auth/admin";
import { getCollection } from "@/lib/admin/collections";
import { deleteCollectionRow, getCollectionRow, updateCollectionRow } from "@/lib/db/repository";
import { cleanupRecordAssets, validateAssetReferences } from "@/lib/storage/assets";
import { adminError, adminJson, ApiError, assertSameOrigin, invalidateContent, readJson } from "../../../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string; id: string }> };

async function cleanup(row: Record<string, unknown>) {
  try {
    const result = await cleanupRecordAssets(row);
    return result.failed > 0 ? "Content saved. Some unused files need another cleanup attempt." : undefined;
  } catch {
    return "Content saved. Unused file cleanup could not finish.";
  }
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
    const warning = await cleanup(previous);
    return adminJson({ row, ...(warning ? { warning } : {}) });
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
    const warning = await cleanup(row);
    return adminJson({ deleted: true, ...(warning ? { warning } : {}) });
  } catch (error) {
    return adminError(error);
  }
}
