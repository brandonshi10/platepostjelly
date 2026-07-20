import { v } from "convex/values";
import { query } from "./_generated/server";
import { assertServiceKey } from "./security";

export const listAuditEvents = query({
  args: {
    serviceKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 100), 1), 500);
    return await ctx.db.query("auditEvents").order("desc").take(limit);
  },
});
