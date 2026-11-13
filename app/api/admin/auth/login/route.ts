import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { cookies } from "next/headers";
import { getAdminAuthConfig } from "@/lib/auth/config";
import { verifyPassword } from "@/lib/auth/password.mjs";
import { ADMIN_COOKIE_NAME, ADMIN_COOKIE_OPTIONS, authDigest, endAdminSession, startAdminSession } from "@/lib/auth/session";
import { consumeLoginAttempt } from "@/lib/auth/store";
import { adminError, adminJson, ApiError, assertSameOrigin, readJson } from "../../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const config = getAdminAuthConfig();
    if (!config) throw new ApiError("Admin sign-in is not configured yet.", 503);
    const input = await readJson(request, 4096);
    if (typeof input.email !== "string" || input.email.length > 254 ||
        typeof input.password !== "string" || !input.password || Buffer.byteLength(input.password, "utf8") > 1024) {
      throw new ApiError("Enter your email address and password.");
    }

    // The global limit remains authoritative even if a caller spoofs forwarded IPs.
    const forwarded = (request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ip = isIP(forwarded) ? forwarded : "unknown";
    const globalAllowed = await consumeLoginAttempt(authDigest(config, "login-limit", "global"), 30, 900);
    const ipAllowed = globalAllowed && await consumeLoginAttempt(authDigest(config, "login-limit", `ip:${ip}`), 10, 900);
    if (!ipAllowed) {
      const response = adminJson({ error: "Too many sign-in attempts. Please try again in 15 minutes." }, 429);
      response.headers.set("Retry-After", "900");
      return response;
    }

    const passwordMatches = await verifyPassword(input.password, config.passwordHash);
    const digest = (value: string) => createHash("sha256").update(value).digest();
    const emailMatches = timingSafeEqual(digest(input.email.trim().toLowerCase()), digest(config.email));
    if (!emailMatches || !passwordMatches) throw new ApiError("Incorrect email or password.", 401);

    await endAdminSession((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
    const token = await startAdminSession(config);
    const response = adminJson({ ok: true });
    response.cookies.set(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    return adminError(error);
  }
}
