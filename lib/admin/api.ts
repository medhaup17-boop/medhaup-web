"use client";

export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "The request failed. Please try again.");
  }
  return data as T;
}

export function collectionPath(slug: string, id?: string): string {
  return `/collections/${encodeURIComponent(slug)}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

export async function uploadAsset(collection: string, field: string, file: File) {
  const contentType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  const ticket = await adminRequest<{ uploadId: string; url: string; headers: Record<string, string> }>("/uploads", {
    method: "POST",
    body: JSON.stringify({ collection, field, fileName: file.name, contentType, size: file.size }),
  });
  try {
    const response = await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: file, credentials: "omit" });
    if (!response.ok) throw new Error("File upload failed. Please retry.");
    return await adminRequest<{ url: string; assetId: string }>(`/uploads/${encodeURIComponent(ticket.uploadId)}/complete`, { method: "POST" });
  } catch (error) {
    // The server also sweeps stale pending uploads if the browser is closed.
    await adminRequest(`/uploads/${encodeURIComponent(ticket.uploadId)}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
