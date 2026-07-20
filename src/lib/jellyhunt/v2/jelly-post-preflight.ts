import "server-only";

import { z } from "zod";
import { JellyhuntV2Error } from "./errors";

const PREFLIGHT_TIMEOUT_MS = 8_000;
const PREFLIGHT_MAX_AGE_MS = 60_000;
const PREFLIGHT_FUTURE_TOLERANCE_MS = 5_000;
const Timestamp = z.string().datetime({ offset: true });

const PartnerPreflight = z
  .object({
    preflightVersion: z.literal("1"),
    ownershipStatus: z.enum(["matched", "mismatched"]),
    reasonCodes: z.array(z.string()),
    post: z
      .object({
        id: z.string().min(1).max(256),
        canonicalOwnerUserId: z.string().min(1).max(256),
        eligibleParticipantIds: z.array(z.string().min(1).max(256)),
        postType: z.string().min(1),
        durationSeconds: z.number().finite().nonnegative(),
        state: z.string().min(1),
        visibility: z.string().min(1),
        moderationStatus: z.string().min(1),
        deletedAt: Timestamp.nullable(),
        postedAt: Timestamp,
        placeId: z.string().min(1),
        observedAt: Timestamp,
      })
      .strict(),
  })
  .strict();

export type ExactJellyPostPreflight = {
  jellyPostId: string;
  canonicalOwnerUserId: string;
  ownershipStatus: "matched";
  checkedAt: number;
};

export type JellyPostPreflightInput = {
  jellyPostId: string;
  submissionPublicId: string;
  jellyUserId: string;
  requestId: string;
};

function dependencyUnavailable(): JellyhuntV2Error {
  return new JellyhuntV2Error(
    503,
    "dependency_unavailable",
    "A required dependency is temporarily unavailable.",
  );
}

function postNotFound(): JellyhuntV2Error {
  return new JellyhuntV2Error(404, "post_not_found", "This Jelly post does not exist.");
}

function postNotEligible(): JellyhuntV2Error {
  return new JellyhuntV2Error(
    422,
    "jelly_post_not_eligible",
    "This Jelly post does not meet the mission requirements.",
  );
}

function requireOpaque(value: string): string {
  if (!value || value !== value.trim() || value.length > 256) throw dependencyUnavailable();
  return value;
}

function requireEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw dependencyUnavailable();
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw dependencyUnavailable();
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw dependencyUnavailable();
  return url.href;
}

async function fetchBounded(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch {
    throw dependencyUnavailable();
  } finally {
    clearTimeout(timeout);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw dependencyUnavailable();
  }
}

function partnerEndpoint(template: string, jellyPostId: string): string {
  const encoded = encodeURIComponent(jellyPostId);
  const raw = template.includes("{postId}")
    ? template.split("{postId}").join(encoded)
    : `${template.replace(/\/$/, "")}/${encoded}`;
  return requireEndpoint(raw);
}

async function partnerPreflight(
  input: JellyPostPreflightInput,
  endpointTemplate: string,
): Promise<ExactJellyPostPreflight> {
  const apiKey = process.env.JELLY_PARTNER_API_KEY;
  if (!apiKey) throw dependencyUnavailable();
  const response = await fetchBounded(partnerEndpoint(endpointTemplate, input.jellyPostId), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Correlation-Id": input.requestId,
    },
    body: JSON.stringify({
      submissionId: input.submissionPublicId,
      userId: input.jellyUserId,
      authorshipPolicy: "canonical_owner",
    }),
  });

  if (response.status === 404) throw postNotFound();
  if (response.status === 429 || response.status >= 500 || !response.ok) {
    throw dependencyUnavailable();
  }

  const parsed = PartnerPreflight.safeParse(await responseJson(response));
  if (!parsed.success) throw dependencyUnavailable();
  const checkedAt = Date.parse(parsed.data.post.observedAt);
  const now = Date.now();
  if (
    checkedAt > now + PREFLIGHT_FUTURE_TOLERANCE_MS ||
    now - checkedAt > PREFLIGHT_MAX_AGE_MS
  ) {
    throw dependencyUnavailable();
  }
  if (
    parsed.data.ownershipStatus !== "matched" ||
    parsed.data.post.id !== input.jellyPostId ||
    parsed.data.post.canonicalOwnerUserId !== input.jellyUserId
  ) {
    throw postNotEligible();
  }

  return {
    jellyPostId: parsed.data.post.id,
    canonicalOwnerUserId: parsed.data.post.canonicalOwnerUserId,
    ownershipStatus: "matched",
    checkedAt,
  };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function unwrapLegacy(payload: unknown): JsonRecord | null {
  const root = record(payload);
  if (!root) return null;
  const data = record(root.data);
  return record(root.jelly) ?? record(data?.jelly) ?? data ?? root;
}

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    ? value
    : null;
}

function oneConsistent(values: unknown[]): string | null {
  const candidates = values.map(nonempty).filter((value): value is string => value !== null);
  if (candidates.length === 0 || candidates.some((value) => value !== candidates[0])) return null;
  return candidates[0] ?? null;
}

async function legacyPreflight(input: JellyPostPreflightInput): Promise<ExactJellyPostPreflight> {
  const baseUrl = (process.env.JELLY_API_BASE_URL ?? "https://api.jellyjelly.com").replace(/\/$/, "");
  const endpoint = requireEndpoint(`${baseUrl}/v3/jelly/${encodeURIComponent(input.jellyPostId)}`);
  const token = process.env.JELLY_LEGACY_API_TOKEN;
  const response = await fetchBounded(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Correlation-Id": input.requestId,
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
  });

  if (response.status === 404) throw postNotFound();
  if (response.status === 429 || response.status >= 500 || !response.ok) {
    throw dependencyUnavailable();
  }
  const jelly = unwrapLegacy(await responseJson(response));
  if (!jelly) throw dependencyUnavailable();
  const owner = record(jelly.owner);
  const canonicalPostId = oneConsistent([jelly.id, jelly.jelly_id, jelly.jellyId]);
  const canonicalOwnerUserId = oneConsistent([
    jelly.started_by_id,
    jelly.startedById,
    jelly.owner_id,
    jelly.userId,
    nonempty(jelly.owner),
    owner?.id,
    owner?.userId,
  ]);
  if (!canonicalPostId || canonicalPostId !== input.jellyPostId || !canonicalOwnerUserId) {
    throw dependencyUnavailable();
  }
  if (canonicalOwnerUserId !== input.jellyUserId) throw postNotEligible();

  return {
    jellyPostId: canonicalPostId,
    canonicalOwnerUserId,
    ownershipStatus: "matched",
    checkedAt: Date.now(),
  };
}

export async function preflightJellyPost(
  input: JellyPostPreflightInput,
): Promise<ExactJellyPostPreflight> {
  const normalized = {
    ...input,
    jellyPostId: requireOpaque(input.jellyPostId),
    submissionPublicId: requireOpaque(input.submissionPublicId),
    jellyUserId: requireOpaque(input.jellyUserId),
  };
  const partnerUrl = process.env.JELLY_PARTNER_PREFLIGHT_URL?.trim();
  return partnerUrl
    ? partnerPreflight(normalized, partnerUrl)
    : legacyPreflight(normalized);
}
