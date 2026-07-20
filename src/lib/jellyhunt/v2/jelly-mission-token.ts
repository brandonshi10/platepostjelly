import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";
import { unauthorized } from "./errors";

export type JellyScope = "jellyhunt:read" | "jellyhunt:submit";

export type JellyViewer = {
  jellyUserId: string;
  sessionId: string;
  tokenId: string;
  scopes: ReadonlySet<JellyScope>;
};

const AUDIENCE = "platepost-jellyhunt";
const ALGORITHMS = ["RS256", "ES256", "EdDSA"];
const MAX_LIFETIME_SECONDS = 300;
const CLOCK_TOLERANCE_SECONDS = 30;

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksUrl: string | null = null;

function isAllowedJwksUrl(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  const value = process.env.JELLY_MISSION_JWKS_URL;
  if (!value) throw unauthorized();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unauthorized();
  }
  if (!isAllowedJwksUrl(url)) throw unauthorized();

  if (!cachedJwks || cachedJwksUrl !== url.href) {
    cachedJwks = createRemoteJWKSet(url);
    cachedJwksUrl = url.href;
  }
  return cachedJwks;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token || null;
}

function parseScopes(raw: unknown): Set<JellyScope> {
  const scopes = new Set<JellyScope>();
  if (typeof raw !== "string") return scopes;
  for (const part of raw.split(/\s+/).filter(Boolean)) {
    if (part === "jellyhunt:read" || part === "jellyhunt:submit") scopes.add(part);
  }
  return scopes;
}

function isNonEmptyUnpaddedClaim(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

async function verifyToken(token: string, scope?: JellyScope): Promise<JellyViewer> {
  const issuer = process.env.JELLY_MISSION_TOKEN_ISSUER;
  if (!issuer) throw unauthorized();

  let payload;
  try {
    const result = await jwtVerify(token, getJwks(), {
      issuer,
      audience: AUDIENCE,
      algorithms: ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    payload = result.payload;
  } catch {
    throw unauthorized();
  }

  const { sub, session_id: sessionIdClaim, jti, iat, exp, scope: scopeClaim } =
    payload as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (
    !isNonEmptyUnpaddedClaim(sub) ||
    !isNonEmptyUnpaddedClaim(sessionIdClaim) ||
    !isNonEmptyUnpaddedClaim(jti) ||
    typeof iat !== "number" ||
    !Number.isInteger(iat) ||
    typeof exp !== "number" ||
    !Number.isInteger(exp) ||
    exp <= iat ||
    exp - iat > MAX_LIFETIME_SECONDS ||
    iat > now + CLOCK_TOLERANCE_SECONDS
  ) {
    throw unauthorized();
  }

  const scopes = parseScopes(scopeClaim);
  if (scope && !scopes.has(scope)) throw unauthorized();

  return {
    jellyUserId: sub,
    sessionId: sessionIdClaim,
    tokenId: jti,
    scopes,
  };
}

export async function requireJellyViewer(request: Request, scope: JellyScope): Promise<JellyViewer> {
  const token = extractBearerToken(request);
  if (!token) throw unauthorized();
  return verifyToken(token, scope);
}

export async function optionalJellyViewer(request: Request, scope?: JellyScope): Promise<JellyViewer | null> {
  if (!request.headers.get("authorization")) return null;
  const token = extractBearerToken(request);
  if (!token) throw unauthorized();
  return verifyToken(token, scope);
}

export function normalizeOpaqueJellyId(value: string): string {
  return value.trim();
}

export function normalizeCanonicalUsername(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}
