import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PREFIX = "scrypt:32768:8:3:";
const PATTERN = /^scrypt:32768:8:3:[a-f0-9]{32}:[a-f0-9]{128}$/;

/** @param {unknown} value */
export function isPasswordHash(value) {
  return typeof value === "string" && PATTERN.test(value);
}

/** @param {string} password @param {Buffer} salt @returns {Promise<Buffer>} */
function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** @param {string} password */
export async function createPasswordHash(password) {
  if ([...password].length < 15 || Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("Choose a password with at least 15 characters and at most 1024 bytes.");
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${PREFIX}${salt.toString("hex")}:${key.toString("hex")}`;
}

/** @param {string} password @param {string} encoded */
export async function verifyPassword(password, encoded) {
  if (!isPasswordHash(encoded) || Buffer.byteLength(password, "utf8") > 1024) return false;
  const parts = encoded.split(":");
  const actual = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex"));
}
