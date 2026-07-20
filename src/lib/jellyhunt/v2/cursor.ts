import "server-only";

import { canonicalize } from "json-canonicalize";
import { internalError, invalidCursor } from "./errors";

export type CursorPayload = {
  version: 1;
  resource: string;
  subjectHash?: string;
  queryHash: string;
  limit: number;
  scopeKey?: string;
  snapshot: string;
  lastSortValues: (string | number)[];
  issuedAt: number;
  expiresAt: number;
};

export type CursorBinding = {
  resource: string;
  subject?: string;
  queryHash: string;
  limit: number;
  scopeKey?: string;
  snapshot?: string;
};

function getSecret(): string {
  const secret = process.env.JELLYHUNT_CURSOR_SECRET;
  if (!secret) throw internalError();
  return secret;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

async function hmacVerify(
  secret: string,
  data: string,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(data));
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === 1 &&
    typeof payload.resource === "string" &&
    payload.resource.length > 0 &&
    (payload.subjectHash === undefined ||
      (typeof payload.subjectHash === "string" && /^[0-9a-f]{64}$/.test(payload.subjectHash))) &&
    typeof payload.queryHash === "string" &&
    payload.queryHash.length > 0 &&
    Number.isInteger(payload.limit) &&
    (payload.limit as number) > 0 &&
    (payload.scopeKey === undefined || typeof payload.scopeKey === "string") &&
    typeof payload.snapshot === "string" &&
    payload.snapshot.length > 0 &&
    Array.isArray(payload.lastSortValues) &&
    payload.lastSortValues.every(
      (part) => typeof part === "string" || (typeof part === "number" && Number.isFinite(part)),
    ) &&
    typeof payload.issuedAt === "number" &&
    Number.isFinite(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) &&
    payload.expiresAt > payload.issuedAt
  );
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashCursorSubject(subject: string): Promise<string> {
  const normalized = subject.trim();
  if (!normalized) throw invalidCursor();
  return sha256Hex(normalized);
}

export async function sealCursor(payload: CursorPayload): Promise<string> {
  if (!isCursorPayload(payload)) throw invalidCursor();
  const json = canonicalize(payload as never);
  const signature = await hmacSign(getSecret(), json);
  return `${base64UrlEncode(signature)}.${base64UrlEncode(new TextEncoder().encode(json))}`;
}

export async function openCursor(token: string, binding: CursorBinding): Promise<CursorPayload> {
  const parts = token.split(".");
  if (parts.length !== 2) throw invalidCursor();

  try {
    const [signaturePart, payloadPart] = parts;
    const json = new TextDecoder(undefined, { fatal: true }).decode(base64UrlDecode(payloadPart));
    const parsed = JSON.parse(json) as unknown;
    if (!isCursorPayload(parsed) || canonicalize(parsed as never) !== json) throw invalidCursor();

    const signature = base64UrlDecode(signaturePart);
    if (!(await hmacVerify(getSecret(), json, signature))) throw invalidCursor();

    const expectedSubjectHash = binding.subject
      ? await hashCursorSubject(binding.subject)
      : undefined;
    if (
      parsed.resource !== binding.resource ||
      parsed.subjectHash !== expectedSubjectHash ||
      parsed.queryHash !== binding.queryHash ||
      parsed.limit !== binding.limit ||
      parsed.scopeKey !== binding.scopeKey ||
      (binding.snapshot !== undefined && parsed.snapshot !== binding.snapshot) ||
      parsed.expiresAt <= Date.now()
    ) {
      throw invalidCursor();
    }

    return parsed;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "errorCode" in error &&
      (error as { errorCode?: unknown }).errorCode === "internal_error"
    ) {
      throw error;
    }
    throw invalidCursor();
  }
}

export async function computeQueryHash(params: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalize(params));
}
