import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "jellyhunt_admin";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export type AdminSession = {
  username: string;
  issuedAt: number;
};

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSession(
  username: string,
  secret: string,
  now = Date.now(),
) {
  if (!username.trim()) throw new Error("Admin username is required");
  if (!secret) throw new Error("Admin session secret is required");

  const payload = Buffer.from(
    JSON.stringify({ username: username.trim(), issuedAt: now } satisfies AdminSession),
  ).toString("base64url");

  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminSession(
  token: string | null | undefined,
  secret: string | null | undefined,
  maxAgeMs = ADMIN_SESSION_MAX_AGE_SECONDS * 1_000,
  now = Date.now(),
): AdminSession | null {
  if (!token || !secret || maxAgeMs <= 0 || token.length > 2_048) return null;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, providedSignature] = parts;
  const expectedSignature = sign(payload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AdminSession>;
    if (
      typeof parsed.username !== "string" ||
      !parsed.username.trim() ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isSafeInteger(parsed.issuedAt) ||
      parsed.issuedAt < 0 ||
      parsed.issuedAt > now ||
      now - parsed.issuedAt > maxAgeMs
    ) {
      return null;
    }
    return { username: parsed.username, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}
