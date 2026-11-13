import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import nextEnv from "@next/env";
import { createPasswordHash } from "../lib/auth/password.mjs";

const { loadEnvConfig } = nextEnv;

const files = [".env.local", ".env.vercel.auth", ".env.admin-credentials"];

async function hiddenPassword() {
  if (!process.stdin.isTTY) throw new Error("Use --email EMAIL --generate in a non-interactive terminal.");
  process.stdout.write("Password (15+ characters; leave blank to generate): ");
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }
    function onKey(text, key) {
      if (key?.ctrl && key.name === "c") return finish(new Error("Setup cancelled."));
      if (key?.name === "return" || key?.name === "enter") return finish();
      if (key?.name === "backspace") {
        if (value) { value = [...value].slice(0, -1).join(""); process.stdout.write("\b \b"); }
      } else if (text && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        value += text;
        process.stdout.write("*");
      }
    }
    process.stdin.on("keypress", onKey);
  });
}

async function question(prompt) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return await input.question(prompt); }
  finally { input.close(); }
}

async function main() {
  let email;
  let generate = false;
  let force = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) email = args[++i];
    else if (args[i] === "--generate") generate = true;
    else if (args[i] === "--force") force = true;
    else throw new Error("Usage: npm run admin:setup -- [--email EMAIL] [--generate] [--force]");
  }
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  for (const file of files) {
    if (execFileSync("git", ["check-ignore", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() !== file) {
      throw new Error(`${file} must be ignored by Git before setup.`);
    }
  }
  if ((process.env.ADMIN_PASSWORD_HASH || existsSync(files[1]) || existsSync(files[2])) && !force) {
    if (!process.stdin.isTTY) throw new Error("Admin credentials already exist. Use --force only to replace them and revoke existing sessions.");
    if ((await question("Replace admin credentials and revoke existing sessions? [y/N] ")).trim().toLowerCase() !== "y") {
      throw new Error("Setup cancelled.");
    }
  }
  if (!email) {
    if (!process.stdin.isTTY) throw new Error("Pass --email EMAIL when using --generate.");
    email = await question(`Admin email${process.env.ADMIN_EMAIL ? ` [${process.env.ADMIN_EMAIL}]` : ""}: `);
    email ||= process.env.ADMIN_EMAIL;
  }
  email = email?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[#$'"`\\]/.test(email)) {
    throw new Error("Enter a valid email address without dotenv special characters.");
  }
  const password = (generate ? "" : await hiddenPassword()) || randomBytes(24).toString("base64url");
  const values = {
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD_HASH: await createPasswordHash(password),
    ADMIN_SESSION_SECRET: randomBytes(32).toString("hex"),
  };
  let local = existsSync(files[0]) ? readFileSync(files[0], "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, "gm");
    if (pattern.test(local)) local = local.replace(pattern, () => `${key}=${value}`);
    else local += `${local.endsWith("\n") || !local ? "" : "\n"}${key}=${value}\n`;
  }
  writeFileSync(files[0], local, { mode: 0o600 });
  writeFileSync(files[1], "# Private admin settings: import into Vercel Production.\n" +
    Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  // Owner-only lookup file. The app never reads this file or stores a raw password in D1.
  writeFileSync(files[2], "# Private login details. Do not commit or share this file.\n" +
    `ADMIN_EMAIL=${email}\nADMIN_PASSWORD=${JSON.stringify(password)}\n`, { mode: 0o600 });
  process.stdout.write("Admin credentials configured.\nPrivate login details: .env.admin-credentials\nVercel import file: .env.vercel.auth\nRestart the local app; import the three auth variables and redeploy Vercel to use them there.\n");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
