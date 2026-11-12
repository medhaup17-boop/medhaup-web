import { requireAdmin } from "@/lib/auth/admin";
import { beginUpload } from "@/lib/storage/r2";
import { adminError, adminJson, assertSameOrigin, readJson } from "../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { userId } = await requireAdmin();
    return adminJson(await beginUpload(await readJson(request), userId), 201);
  } catch (error) { return adminError(error); }
}
