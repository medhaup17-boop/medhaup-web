import { requireAdmin } from "@/lib/auth/admin";
import { getCollection } from "@/lib/admin/collections";
import { createCollectionRow, listCollection } from "@/lib/db/repository";
import { validateAssetReferences } from "@/lib/storage/assets";
import { adminError, adminJson, ApiError, assertSameOrigin, invalidateContent, readJson } from "../../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await requireAdmin();
    const { slug } = await context.params;
    if (!getCollection(slug)) throw new ApiError("Collection not found.", 404);
    const search = new URL(request.url).searchParams;
    // Admin editing needs full article bodies; keep those pages below host limits.
    const maximum = slug === "blogs" ? 10 : 50;
    const limit = Number(search.get("limit") ?? (slug === "blogs" ? 10 : 50));
    const offset = Number(search.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > maximum || !Number.isInteger(offset) || offset < 0) {
      throw new ApiError("Invalid page size or offset.");
    }
    const rows = await listCollection(slug, { limit: limit + 1, offset });
    return adminJson({ rows: rows.slice(0, limit), hasMore: rows.length > limit });
  } catch (error) {
    return adminError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const { slug } = await context.params;
    if (!getCollection(slug)) throw new ApiError("Collection not found.", 404);
    const payload = await readJson(request);
    await validateAssetReferences(slug, payload);
    const row = await createCollectionRow(slug, payload);
    invalidateContent();
    return adminJson({ row }, 201);
  } catch (error) {
    return adminError(error);
  }
}
