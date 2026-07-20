import { canonicalize } from "json-canonicalize";

export type CachePolicy = { type: "public"; maxAge: number } | { type: "private" };

export function applyCacheHeaders(headers: Headers, policy: CachePolicy, etag?: string): void {
  if (policy.type === "public") {
    headers.set("Cache-Control", `public, max-age=${policy.maxAge}`);
  } else {
    headers.set("Cache-Control", "private, no-store");
    headers.set("Vary", "Authorization");
  }
  if (etag) {
    headers.set("ETag", etag);
  }
}

function withoutVolatileEnvelopeMetadata(resource: unknown): unknown {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    return resource;
  }

  const record = resource as Record<string, unknown>;
  const meta = record.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return resource;
  }

  const stableMeta = { ...(meta as Record<string, unknown>) };
  delete stableMeta.requestId;
  delete stableMeta.generatedAt;
  return { ...record, meta: stableMeta };
}

export async function semanticEtag(resource: unknown): Promise<string> {
  const canonical = canonicalize(withoutVolatileEnvelopeMetadata(resource) as never);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `W/"${hex}"`;
}
