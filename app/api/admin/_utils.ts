import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { AdminAccessError } from "@/lib/auth/admin";
import { ValidationError } from "@/lib/db/repository";
import { StorageError } from "@/lib/storage/validation";
import { DatabaseError } from "@/lib/cloudflare/d1";

export class ApiError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ApiError";
  }
}

/** Cookie-authenticated mutations must originate from this exact app origin. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new ApiError("This request must come from the admin website.", 403);
  }
}

export async function readJson(request: Request, maxBytes = 262_144): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError("Send an application/json request.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError("The submitted content is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("The request contains invalid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError("The request body must be an object.");
  }
  return data as Record<string, unknown>;
}

export function adminJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function adminError(error: unknown) {
  if (error instanceof AdminAccessError || error instanceof ApiError || error instanceof StorageError || error instanceof DatabaseError) {
    return adminJson({ error: error.message }, error.status);
  }
  if (error instanceof ValidationError) {
    return adminJson({ error: error.message }, 400);
  }
  // Never return credentials, SQL, provider responses, or internal URLs to callers.
  console.error("[admin] Operation failed", error instanceof Error ? error.name : "UnknownError");
  return adminJson({ error: "The operation could not be completed. Please try again." }, 500);
}

export function invalidateContent() {
  revalidateTag("content", { expire: 0 });
  revalidatePath("/", "layout");
}
