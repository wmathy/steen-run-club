import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Encrypt Google OAuth tokens at rest using a key derived from SESSION_SECRET.
 * Residual risk: if SESSION_SECRET and DB leak together, tokens are recoverable.
 * Documented in README.
 */

const ALGO = "aes-256-gcm";

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET required for token encryption");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // v1:iv:tag:ciphertext (all base64)
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  // Backward-compatible: plaintext tokens from before encryption
  if (!payload.startsWith("v1:")) {
    return payload;
  }
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted token format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = deriveKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
