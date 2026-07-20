import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

const PROCESSING_LEASE_MS = 60_000;
const DAY_MS = 86_400_000;
const MINIMUM_RESPONSE_RETENTION_MS = 180 * DAY_MS;
const CAMPAIGN_RETENTION_AFTER_END_MS = 90 * DAY_MS;
const HTTP_TOKEN = /^[A-Z!#$%&'*+.^_`|~-]+$/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

function requireNonEmpty(value: string, code: string): string {
  if (value.length === 0) throw new Error(code);
  return value;
}

export function normalizeIdempotencySubject(value: string): string {
  return requireNonEmpty(value.trim(), "invalid_jelly_subject_id");
}

export function normalizeHttpMethod(value: string): string {
  const method = value.trim().toUpperCase();
  if (!HTTP_TOKEN.test(method)) throw new Error("invalid_http_method");
  return method;
}

export function normalizeHttpPath(value: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /%(?![0-9A-Fa-f]{2})/.test(value)
  ) {
    throw new Error("invalid_normalized_path");
  }

  const percentNormalized = value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
    const decoded = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(decoded) ? decoded : `%${hex.toUpperCase()}`;
  });
  const output: string[] = [];
  for (const segment of percentNormalized.split("/").slice(1)) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (output.length > 0) output.pop();
      continue;
    }
    output.push(segment);
  }
  let normalized = `/${output.join("/")}`;
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function retentionDeadline(now: number, campaignEndsAt?: number): number {
  const minimum = now + MINIMUM_RESPONSE_RETENTION_MS;
  if (campaignEndsAt === undefined) return minimum;
  if (!Number.isFinite(campaignEndsAt)) throw new Error("invalid_campaign_end");
  return Math.max(minimum, campaignEndsAt + CAMPAIGN_RETENTION_AFTER_END_MS);
}

async function loadRecord(
  ctx: any,
  jellySubjectId: string,
  httpMethod: string,
  normalizedPath: string,
  keyHash: string,
) {
  return await ctx.db
    .query("jellyhuntIdempotencyRecords")
    .withIndex("by_subject_method_path_key_hash", (q: any) =>
      q
        .eq("jellySubjectId", jellySubjectId)
        .eq("httpMethod", httpMethod)
        .eq("normalizedPath", normalizedPath)
        .eq("keyHash", keyHash),
    )
    .unique();
}

async function loadBoundSubmission(ctx: any, resourcePublicId: string) {
  return await ctx.db
    .query("jellyhuntSubmissions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", resourcePublicId))
    .unique();
}

function acquiredResponse(
  recordId: any,
  leaseOwner: string,
  leaseGeneration: number,
  processingExpiresAt: number,
  expiresAt: number,
  resourcePublicId?: string,
) {
  return {
    status: "acquired",
    recordId,
    leaseOwner,
    leaseGeneration,
    processingExpiresAt,
    expiresAt,
    ...(resourcePublicId !== undefined ? { resourcePublicId } : {}),
  };
}

export type AcquireIdempotencyLeaseArgs = {
  jellySubjectId: string;
  httpMethod: string;
  normalizedPath: string;
  idempotencyKey: string;
  requestHash: string;
  originalRequestId: string;
  leaseOwner: string;
  resourcePublicId?: string;
  campaignEndsAt?: number;
  now: number;
};

/** Plain helper so a public orchestration mutation can acquire without nesting mutations. */
export async function acquireIdempotencyLeaseInternal(ctx: any, args: AcquireIdempotencyLeaseArgs) {
  const jellySubjectId = normalizeIdempotencySubject(args.jellySubjectId);
  const httpMethod = normalizeHttpMethod(args.httpMethod);
  const normalizedPath = normalizeHttpPath(args.normalizedPath);
  const idempotencyKey = requireNonEmpty(args.idempotencyKey, "invalid_idempotency_key");
  const requestHash = requireNonEmpty(args.requestHash, "invalid_request_hash");
  const originalRequestId = requireNonEmpty(args.originalRequestId, "invalid_original_request_id");
  const leaseOwner = requireNonEmpty(args.leaseOwner, "invalid_lease_owner");
  const resourcePublicId = args.resourcePublicId === undefined
    ? undefined
    : requireNonEmpty(args.resourcePublicId.trim(), "invalid_resource_public_id");
  const keyHash = await sha256Hex(idempotencyKey);
  const requestedExpiresAt = retentionDeadline(args.now, args.campaignEndsAt);
  const existing = await loadRecord(ctx, jellySubjectId, httpMethod, normalizedPath, keyHash);

  if (!existing) {
    const processingExpiresAt = args.now + PROCESSING_LEASE_MS;
    const leaseGeneration = 1;
    const recordId = await ctx.db.insert("jellyhuntIdempotencyRecords", {
      jellySubjectId,
      httpMethod,
      normalizedPath,
      keyHash,
      requestHash,
      state: "processing",
      leaseOwner,
      leaseGeneration,
      processingExpiresAt,
      originalRequestId,
      resourcePublicId,
      createdAt: args.now,
      expiresAt: requestedExpiresAt,
    });
    return acquiredResponse(
      recordId,
      leaseOwner,
      leaseGeneration,
      processingExpiresAt,
      requestedExpiresAt,
      resourcePublicId,
    );
  }

  if (existing.requestHash !== requestHash) return { status: "key_reused" };

  if (existing.expiresAt <= args.now || existing.state === "expired") {
    if (existing.state !== "expired") {
      await ctx.db.patch(existing._id, {
        state: "expired",
        processingExpiresAt: undefined,
        finalizedAt: existing.finalizedAt ?? args.now,
      });
    }
    return { status: "expired", originalRequestId: existing.originalRequestId };
  }

  if (existing.state === "completed") {
    return {
      status: "replay",
      response: {
        status: existing.responseStatus,
        bodyJson: existing.responseBodyJson,
        ...(existing.responseHeadersJson !== undefined ? { headersJson: existing.responseHeadersJson } : {}),
        ...(existing.locationHeader !== undefined ? { locationHeader: existing.locationHeader } : {}),
        ...(existing.resourceId !== undefined ? { resourceId: existing.resourceId } : {}),
        originalRequestId: existing.originalRequestId,
      },
    };
  }

  if (existing.processingExpiresAt !== undefined && existing.processingExpiresAt > args.now) {
    return { status: "in_progress", retryAfter: existing.processingExpiresAt - args.now };
  }
  if (!existing.resourcePublicId) return { status: "recovery_required" };

  const durableSubmission = await loadBoundSubmission(ctx, existing.resourcePublicId);
  if (durableSubmission) {
    // Durable work without the exact finalized response cannot be safely reconstructed.
    return { status: "recovery_required" };
  }

  const leaseGeneration = (existing.leaseGeneration ?? 0) + 1;
  const processingExpiresAt = args.now + PROCESSING_LEASE_MS;
  const expiresAt = Math.max(existing.expiresAt, requestedExpiresAt);
  await ctx.db.patch(existing._id, { leaseOwner, leaseGeneration, processingExpiresAt, expiresAt });
  return acquiredResponse(
    existing._id,
    leaseOwner,
    leaseGeneration,
    processingExpiresAt,
    expiresAt,
    existing.resourcePublicId,
  );
}

const acquireArgs = {
  jellySubjectId: v.string(),
  httpMethod: v.string(),
  normalizedPath: v.string(),
  idempotencyKey: v.string(),
  requestHash: v.string(),
  originalRequestId: v.string(),
  leaseOwner: v.string(),
  resourcePublicId: v.optional(v.string()),
  campaignEndsAt: v.optional(v.number()),
  now: v.number(),
};

export const acquireIdempotencyLease = internalMutationGeneric({
  args: acquireArgs,
  handler: async (ctx: any, args: any) => acquireIdempotencyLeaseInternal(ctx, args),
});

export type ActiveIdempotencyLeaseIdentity = {
  recordId: any;
  jellySubjectId: string;
  httpMethod: string;
  normalizedPath: string;
  requestHash: string;
  leaseOwner: string;
  leaseGeneration: number;
  resourcePublicId: string;
  now: number;
};

/** Verify every durable binding before any submission side effect is written. */
export async function requireActiveIdempotencyLeaseInternal(
  ctx: any,
  identity: ActiveIdempotencyLeaseIdentity,
) {
  const record = await ctx.db.get(identity.recordId);
  if (!record || record.state !== "processing") throw new Error("idempotency_record_not_processing");

  const jellySubjectId = normalizeIdempotencySubject(identity.jellySubjectId);
  if (record.jellySubjectId !== jellySubjectId) throw new Error("idempotency_subject_mismatch");
  if (record.httpMethod !== normalizeHttpMethod(identity.httpMethod)) {
    throw new Error("idempotency_method_mismatch");
  }
  if (record.normalizedPath !== normalizeHttpPath(identity.normalizedPath)) {
    throw new Error("idempotency_path_mismatch");
  }
  if (record.requestHash !== requireNonEmpty(identity.requestHash, "invalid_request_hash")) {
    throw new Error("idempotency_request_mismatch");
  }
  if (
    record.leaseOwner !== requireNonEmpty(identity.leaseOwner, "invalid_lease_owner") ||
    record.leaseGeneration !== identity.leaseGeneration
  ) {
    throw new Error("idempotency_stale_lease");
  }
  const resourcePublicId = requireNonEmpty(identity.resourcePublicId.trim(), "invalid_resource_public_id");
  if (record.resourcePublicId !== resourcePublicId) throw new Error("idempotency_resource_mismatch");
  if (record.processingExpiresAt === undefined || record.processingExpiresAt <= identity.now) {
    throw new Error("idempotency_lease_expired");
  }
  return record;
}

function assertFinalizableResponseStatus(responseStatus: number): void {
  if (!Number.isInteger(responseStatus)) throw new Error("invalid_response_status");
  if (responseStatus === 429 || responseStatus >= 500) {
    throw new Error("transient_response_not_finalizable");
  }
  if (!((responseStatus >= 200 && responseStatus <= 299) || (responseStatus >= 400 && responseStatus <= 499))) {
    throw new Error("response_not_finalizable");
  }
}

export type CompleteIdempotencyRecordArgs = {
  responseStatus: number;
  responseBodyJson: string;
  responseHeadersJson?: string;
  locationHeader?: string;
  resourceId?: string;
  campaignEndsAt?: number;
  now: number;
};

/** Complete a previously verified record inside the caller's transaction. */
export async function completeIdempotencyRecordInternal(
  ctx: any,
  record: any,
  args: CompleteIdempotencyRecordArgs,
) {
  assertFinalizableResponseStatus(args.responseStatus);
  if (record.state !== "processing") throw new Error("idempotency_record_not_processing");
  if (record.processingExpiresAt === undefined || record.processingExpiresAt <= args.now) {
    throw new Error("idempotency_lease_expired");
  }
  if (args.resourceId !== undefined && record.resourcePublicId !== undefined && args.resourceId !== record.resourcePublicId) {
    throw new Error("idempotency_resource_mismatch");
  }

  await ctx.db.patch(record._id, {
    state: "completed",
    processingExpiresAt: undefined,
    responseStatus: args.responseStatus,
    responseBodyJson: args.responseBodyJson,
    responseHeadersJson: args.responseHeadersJson,
    locationHeader: args.locationHeader,
    resourceId: args.resourceId,
    finalizedAt: args.now,
    expiresAt: Math.max(record.expiresAt, retentionDeadline(args.now, args.campaignEndsAt)),
  });
  return { status: "completed" };
}

/** Release only the processing lease; the durable key/request binding remains reclaimable. */
export async function abandonIdempotencyLeaseInternal(
  ctx: any,
  identity: ActiveIdempotencyLeaseIdentity,
) {
  const record = await requireActiveIdempotencyLeaseInternal(ctx, identity);
  await ctx.db.patch(record._id, { processingExpiresAt: identity.now });
  return { status: "abandoned" };
}
export const completeIdempotencyRecord = internalMutationGeneric({
  args: {
    recordId: v.id("jellyhuntIdempotencyRecords"),
    leaseOwner: v.string(),
    leaseGeneration: v.number(),
    responseStatus: v.number(),
    responseBodyJson: v.string(),
    responseHeadersJson: v.optional(v.string()),
    locationHeader: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    campaignEndsAt: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    const record = await ctx.db.get(args.recordId);
    if (
      !record ||
      record.state !== "processing" ||
      record.leaseOwner !== args.leaseOwner ||
      record.leaseGeneration !== args.leaseGeneration
    ) {
      return { status: "stale_lease" };
    }

    return completeIdempotencyRecordInternal(ctx, record, args);
  },
});

export const expireIdempotencyRecord = internalMutationGeneric({
  args: {
    recordId: v.id("jellyhuntIdempotencyRecords"),
    leaseOwner: v.string(),
    leaseGeneration: v.number(),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    const record = await ctx.db.get(args.recordId);
    if (
      !record ||
      record.state !== "processing" ||
      record.leaseOwner !== args.leaseOwner ||
      record.leaseGeneration !== args.leaseGeneration
    ) {
      return { status: "stale_lease" };
    }

    await ctx.db.patch(record._id, {
      state: "expired",
      processingExpiresAt: undefined,
      finalizedAt: args.now,
    });
    return { status: "expired" };
  },
});