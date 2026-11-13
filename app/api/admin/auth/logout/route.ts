import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, ADMIN_COOKIE_OPTIONS, endAdminSession } from "@/lib/auth/session";
import { adminError, adminJson, assertSameOrigin } from "../../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
    await endAdminSession(token);
    const response = adminJson({ ok: true });
    response.cookies.set(ADMIN_COOKIE_NAME, "", { ...ADMIN_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  } catch (error) {
    return adminError(error);
  }
}
