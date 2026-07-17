import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import { requireServiceKey } from "./security";

/**
 * Shared audit-trail helper for every namespaced JellyHunt admin/service
 * mutation. Every admin/server mutation in `convex/jellyhunt/*.ts` calls
 * `recordAuditEvent` in the same transaction as its data write so
 * `jellyhuntAuditEvents` always carries the actor, the originating request,
 * and the before/after state for that write.
 *
 * `ctx` is intentionally typed as the untyped `GenericMutationCtx<any>`
 * rather than a generated, schema-bound mutation ctx: this repository has
 * not run Convex codegen yet (no `convex/_generated`), so every namespaced
 * JellyHunt function in this task is built directly on `convex/server`'s
 * generic `mutationGeneric`/`queryGeneric` builders instead of the
 * generated `./_generated/server` wrappers. Runtime behavior is identical;
 * only compile-time argument/return inference is lost, which these modules
 * recover with local `v.*` validators instead.
 */
export type AuditEventInput = {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  previousState?: unknown;
  nextState?: unknown;
  requestId?: string;
  metadata?: unknown;
};

export async function recordAuditEvent(
  ctx: GenericMutationCtx<any>,
  event: AuditEventInput,
): Promise<void> {
  await ctx.db.insert("jellyhuntAuditEvents", {
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    previousStateJson: event.previousState === undefined ? undefined : JSON.stringify(event.previousState),
    nextStateJson: event.nextState === undefined ? undefined : JSON.stringify(event.nextState),
    metadataJson:
      event.requestId === undefined && event.metadata === undefined
        ? undefined
        : JSON.stringify({ requestId: event.requestId, ...(event.metadata !== undefined ? { metadata: event.metadata } : {}) }),
    createdAt: Date.now(),
  });
}

/** Admin/service-only read of the append-only JellyHunt audit trail. */
export const listAuditEvents = queryGeneric({
  args: {
    serviceKey: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 100), 1), 500);
    if (args.entityType && args.entityId) {
      return await ctx.db
        .query("jellyhuntAuditEvents")
        .withIndex("by_entity", (q: any) => q.eq("entityType", args.entityType).eq("entityId", args.entityId))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("jellyhuntAuditEvents").order("desc").take(limit);
  },
});
