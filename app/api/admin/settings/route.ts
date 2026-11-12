import { requireAdmin } from "@/lib/auth/admin";
import { getSettings, saveSettings } from "@/lib/db/repository";
import { adminError, adminJson, assertSameOrigin, invalidateContent, readJson } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return adminJson({ data: await getSettings() });
  } catch (error) {
    return adminError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const data = await saveSettings(await readJson(request, 16_384));
    invalidateContent();
    return adminJson({ data });
  } catch (error) {
    return adminError(error);
  }
}
