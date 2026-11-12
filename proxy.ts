import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isClerkConfigured } from "@/lib/auth/config";

const clerk = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Unconfigured installs can render setup guidance. Resource guards fail closed.
  if (!isClerkConfigured()) return NextResponse.next();
  return clerk(request, event);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
