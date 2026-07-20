import { canonicalize } from "json-canonicalize";
import { badRequest } from "./errors";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function invalidIdempotencyKey(): never {
  throw badRequest(
    "invalid_idempotency_key",
    "Idempotency-Key must be a client-generated UUID or ULID of at most 128 characters",
  );
}

export function extractIdempotencyKey(request: Request): string | null {
  const standard = request.headers.get("idempotency-key");
  const legacy = request.headers.get("x-idempotency-key");

  if (!standard && !legacy) return null;

  const standardValue = standard?.trim();
  const legacyValue = legacy?.trim();
  if (standardValue && legacyValue && standardValue !== legacyValue) {
    return invalidIdempotencyKey();
  }

  const value = standardValue || legacyValue;
  if (!value) return null;
  if (
    value.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    (!UUID_PATTERN.test(value) && !ULID_PATTERN.test(value))
  ) {
    return invalidIdempotencyKey();
  }

  return value;
}

export async function computeCanonicalRequestHash(
  method: string,
  path: string,
  body: unknown,
): Promise<string> {
  const canonical = canonicalize({ method, path, body } as never);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
