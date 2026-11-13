import "server-only";

import { isPasswordHash } from "./password.mjs";

export type AdminAuthConfig = { email: string; passwordHash: string; secret: string };

export function getAdminAuthConfig(): AdminAuthConfig | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!passwordHash || !isPasswordHash(passwordHash)) return null;
  if (!secret || !/^[A-Za-z0-9_-]{43,256}$/.test(secret)) return null;
  return { email, passwordHash, secret };
}

export function isAdminAuthConfigured(): boolean {
  return getAdminAuthConfig() !== null;
}
