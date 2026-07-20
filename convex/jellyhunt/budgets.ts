import { internalMutationGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import {
  formatCanonicalRewardAmount,
  parseCanonicalRewardAmount,
} from "./amounts";
import { requireServiceKey } from "./security";

export type BudgetScopeType = "campaign" | "mission" | "day" | "user";

type BudgetScope = {
  scopeType: BudgetScopeType;
  scopeKey: string;
  campaignId?: any;
  missionId?: any;
};

function normalizeScopeKey(scopeKey: string): string {
  const normalized = scopeKey.trim();
  if (!normalized) throw new Error("invalid_budget_scope");
  return normalized;
}

export async function getOrCreateBudgetInternal(ctx: any, args: BudgetScope) {
  const scopeKey = normalizeScopeKey(args.scopeKey);
  const existing = await ctx.db
    .query("jellyhuntRewardBudgets")
    .withIndex("by_scope", (q: any) => q.eq("scopeType", args.scopeType).eq("scopeKey", scopeKey))
    .unique();
  if (existing) return existing;

  const now = Date.now();
  const budgetId = await ctx.db.insert("jellyhuntRewardBudgets", {
    scopeType: args.scopeType,
    scopeKey,
    campaignId: args.campaignId,
    missionId: args.missionId,
    allocatedAmount: "0",
    reservedAmount: "0",
    paidAmount: "0",
    releasedAmount: "0",
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(budgetId);
}

export async function reserveBudgetAmountInternal(
  ctx: any,
  args: BudgetScope & { amount: string },
) {
  const amount = parseCanonicalRewardAmount(args.amount);
  const budget = await getOrCreateBudgetInternal(ctx, args);
  const allocated = parseCanonicalRewardAmount(budget.allocatedAmount, { allowZero: true });
  if (allocated === 0n) throw new Error("budget_not_allocated");

  const reserved = parseCanonicalRewardAmount(budget.reservedAmount, { allowZero: true });
  const paid = parseCanonicalRewardAmount(budget.paidAmount, { allowZero: true });
  const nextReserved = reserved + amount;
  if (nextReserved + paid > allocated) throw new Error("budget_exceeded");

  await ctx.db.patch(budget._id, {
    reservedAmount: formatCanonicalRewardAmount(nextReserved),
    revision: budget.revision + 1,
    updatedAt: Date.now(),
  });
  return await ctx.db.get(budget._id);
}

/** Reserve both canonical scopes used by submission/reward workflows. */
export async function reserveSubmissionRewardBudgetsInternal(
  ctx: any,
  args: {
    campaignId: any;
    campaignPublicId: string;
    missionId: any;
    missionPublicId: string;
    amount: string;
  },
) {
  const campaignBudget = await reserveBudgetAmountInternal(ctx, {
    scopeType: "campaign",
    scopeKey: args.campaignPublicId,
    campaignId: args.campaignId,
    amount: args.amount,
  });
  const missionBudget = await reserveBudgetAmountInternal(ctx, {
    scopeType: "mission",
    scopeKey: args.missionPublicId,
    campaignId: args.campaignId,
    missionId: args.missionId,
    amount: args.amount,
  });
  return { campaignBudget, missionBudget };
}
export async function releaseBudgetAmountInternal(
  ctx: any,
  args: BudgetScope & { amount: string },
) {
  const amount = parseCanonicalRewardAmount(args.amount);
  const budget = await getOrCreateBudgetInternal(ctx, args);
  const reserved = parseCanonicalRewardAmount(budget.reservedAmount, { allowZero: true });
  if (amount > reserved) throw new Error("release_exceeds_reserved");

  const released = parseCanonicalRewardAmount(budget.releasedAmount, { allowZero: true });
  await ctx.db.patch(budget._id, {
    reservedAmount: formatCanonicalRewardAmount(reserved - amount),
    releasedAmount: formatCanonicalRewardAmount(released + amount),
    revision: budget.revision + 1,
    updatedAt: Date.now(),
  });
  return await ctx.db.get(budget._id);
}

export async function markBudgetPaidInternal(
  ctx: any,
  args: BudgetScope & { amount: string },
) {
  const amount = parseCanonicalRewardAmount(args.amount);
  const budget = await getOrCreateBudgetInternal(ctx, args);
  const reserved = parseCanonicalRewardAmount(budget.reservedAmount, { allowZero: true });
  if (amount > reserved) throw new Error("payment_exceeds_reserved");

  const paid = parseCanonicalRewardAmount(budget.paidAmount, { allowZero: true });
  await ctx.db.patch(budget._id, {
    reservedAmount: formatCanonicalRewardAmount(reserved - amount),
    paidAmount: formatCanonicalRewardAmount(paid + amount),
    revision: budget.revision + 1,
    updatedAt: Date.now(),
  });
  return await ctx.db.get(budget._id);
}

export async function transitionSubmissionBudgetsInternal(
  ctx: any,
  args: {
    campaignId: any;
    missionId: any;
    amount: string;
    transition: "release" | "paid";
  },
): Promise<void> {
  const [campaign, mission] = await Promise.all([
    ctx.db.get(args.campaignId),
    ctx.db.get(args.missionId),
  ]);
  if (!campaign || !mission) throw new Error("budget_scope_not_found");

  const scopes: BudgetScope[] = [
    {
      scopeType: "campaign",
      scopeKey: campaign.publicId,
      campaignId: campaign._id,
    },
    {
      scopeType: "mission",
      scopeKey: mission.publicId,
      campaignId: campaign._id,
      missionId: mission._id,
    },
  ];

  for (const scope of scopes) {
    const existing = await ctx.db
      .query("jellyhuntRewardBudgets")
      .withIndex("by_scope", (q: any) =>
        q.eq("scopeType", scope.scopeType).eq("scopeKey", scope.scopeKey),
      )
      .unique();
    if (!existing) throw new Error("budget_scope_not_found");

    if (args.transition === "paid") {
      await markBudgetPaidInternal(ctx, { ...scope, amount: args.amount });
    } else {
      await releaseBudgetAmountInternal(ctx, { ...scope, amount: args.amount });
    }
  }
}
const scopeArgs = {
  scopeType: v.union(v.literal("campaign"), v.literal("mission"), v.literal("day"), v.literal("user")),
  scopeKey: v.string(),
  campaignId: v.optional(v.id("jellyhuntCampaigns")),
  missionId: v.optional(v.id("jellyhuntMissions")),
};

export const getOrCreateBudget = internalMutationGeneric({
  args: scopeArgs,
  handler: async (ctx: any, args: any) => getOrCreateBudgetInternal(ctx, args),
});

export const setBudgetAllocation = mutationGeneric({
  args: {
    serviceKey: v.string(),
    ...scopeArgs,
    allocatedAmount: v.string(),
    expectedRevision: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0) {
      throw new Error("invalid_budget_revision");
    }
    const allocated = parseCanonicalRewardAmount(args.allocatedAmount, { allowZero: true });
    const budget = await getOrCreateBudgetInternal(ctx, args);
    if (budget.revision !== args.expectedRevision) throw new Error("budget_revision_conflict");

    const reserved = parseCanonicalRewardAmount(budget.reservedAmount, { allowZero: true });
    const paid = parseCanonicalRewardAmount(budget.paidAmount, { allowZero: true });
    if (allocated < reserved + paid) throw new Error("allocation_below_committed");

    await ctx.db.patch(budget._id, {
      allocatedAmount: formatCanonicalRewardAmount(allocated),
      revision: budget.revision + 1,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(budget._id);
  },
});

export const reserveBudgetAmount = mutationGeneric({
  args: { serviceKey: v.string(), ...scopeArgs, amount: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    return reserveBudgetAmountInternal(ctx, args);
  },
});

export const releaseBudgetAmount = mutationGeneric({
  args: { serviceKey: v.string(), ...scopeArgs, amount: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    return releaseBudgetAmountInternal(ctx, args);
  },
});

export const markBudgetPaid = mutationGeneric({
  args: { serviceKey: v.string(), ...scopeArgs, amount: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    return markBudgetPaidInternal(ctx, args);
  },
});
