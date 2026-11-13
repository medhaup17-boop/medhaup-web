import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { getAdminAuthConfig, type AdminAuthConfig } from "./config";
import { createAdminSession, deleteAdminSession, hasAdminSession } from "./store";

export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
export const ADMIN_USER_ID = "single-admin";
export const ADMIN_COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-medhaup_admin_session"
  : "medhaup_admin_session";

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: ADMIN_SESSION_SECONDS,
};

export function authDigest(config: AdminAuthConfig, purpose: string, value: string): string {
  return createHmac("sha256", config.secret).update(`${purpose}\0${value}`).digest("hex");
}

function credentialVersion(config: AdminAuthConfig): string {
  return authDigest(config, "credentials", `${config.email}\0${config.passwordHash}`);
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function startAdminSession(config: AdminAuthConfig): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await createAdminSession(
    authDigest(config, "session", token),
    credentialVersion(config),
    Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS,
  );
  return token;
}

export async function verifyAdminSession(token: unknown): Promise<boolean> {
  const config = getAdminAuthConfig();
  if (!config || !validToken(token)) return false;
  return hasAdminSession(authDigest(config, "session", token), credentialVersion(config));
}

export async function endAdminSession(token: unknown): Promise<void> {
  const config = getAdminAuthConfig();
  if (config && validToken(token)) await deleteAdminSession(authDigest(config, "session", token));
}
