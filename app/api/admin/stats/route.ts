import { requireAdmin } from "@/lib/auth/admin";
import { COLLECTIONS } from "@/lib/admin/collections";
import { getCollectionCounts } from "@/lib/db/repository";
import { adminError, adminJson } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const counts = await getCollectionCounts();
    return adminJson({ stats: COLLECTIONS.map(({ slug, title }) => ({ slug, title, ...counts[slug] })) });
  } catch (error) {
    return adminError(error);
  }
}
