import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const profiles = anyApi.jellyhunt.profiles;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

describe("upsertPublicProfile / getPublicProfile", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a new profile with correct fields", async () => {
    const suffix = uniqueSuffix();
    const jellyUserId = `user_${suffix}`;
    const now = Date.now();

    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId,
      username: "AliceJelly",
      accountState: "active",
      now,
    });

    const profile = await t.query(profiles.getPublicProfile, { jellyUserId });
    expect(profile).not.toBeNull();
    expect(profile).toEqual({
      jellyUserId,
      username: "AliceJelly",
      refreshedAt: now,
    });
  });

  it("updates an existing profile's username on re-upsert", async () => {
    const suffix = uniqueSuffix();
    const jellyUserId = `user_${suffix}`;
    const firstNow = Date.now();

    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId,
      username: "OldName",
      accountState: "active",
      now: firstNow,
    });

    const secondNow = firstNow + 1000;
    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId,
      username: "NewName",
      accountState: "active",
      now: secondNow,
    });

    const profile = await t.query(profiles.getPublicProfile, { jellyUserId });
    expect(profile).toEqual({ jellyUserId, username: "NewName", refreshedAt: secondNow });
  });

  it("publicEligible is true only when active with non-empty username", async () => {
    const suffix = uniqueSuffix();
    const now = Date.now();

    const activeEmptyUser = `user_${suffix}_a`;
    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId: activeEmptyUser,
      username: "   ",
      accountState: "active",
      now,
    });
    const activeEmptyRow = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntPublicProfiles").withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", activeEmptyUser)).unique(),
    );
    expect(activeEmptyRow.publicEligible).toBe(false);

    const deletedUser = `user_${suffix}_b`;
    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId: deletedUser,
      username: "SomeName",
      accountState: "deleted",
      now,
    });
    const deletedRow = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntPublicProfiles").withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", deletedUser)).unique(),
    );
    expect(deletedRow.publicEligible).toBe(false);

    const activeUser = `user_${suffix}_c`;
    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId: activeUser,
      username: "SomeName",
      accountState: "active",
      now,
    });
    const activeRow = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntPublicProfiles").withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", activeUser)).unique(),
    );
    expect(activeRow.publicEligible).toBe(true);
  });

  it("returns null for deleted or moderated accounts", async () => {
    const suffix = uniqueSuffix();
    const now = Date.now();

    const deletedUser = `user_${suffix}_deleted`;
    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId: deletedUser,
      username: "Deleted",
      accountState: "deleted",
      now,
    });
    expect(await t.query(profiles.getPublicProfile, { jellyUserId: deletedUser })).toBeNull();

    const moderatedUser = `user_${suffix}_moderated`;
    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId: moderatedUser,
      username: "Moderated",
      accountState: "moderated",
      now,
    });
    expect(await t.query(profiles.getPublicProfile, { jellyUserId: moderatedUser })).toBeNull();
  });

  it("returns the active profile", async () => {
    const suffix = uniqueSuffix();
    const jellyUserId = `user_${suffix}`;
    const now = Date.now();

    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId,
      username: "ActiveUser",
      accountState: "active",
      now,
    });

    const profile = await t.query(profiles.getPublicProfile, { jellyUserId });
    expect(profile).not.toBeNull();
    expect(profile.username).toBe("ActiveUser");
  });

  it("normalizes username by lowercasing and trimming", async () => {
    const suffix = uniqueSuffix();
    const jellyUserId = `user_${suffix}`;
    const now = Date.now();

    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId,
      username: "   MiXedCase_Name  ",
      accountState: "active",
      now,
    });

    const profile = await t.query(profiles.getPublicProfile, { jellyUserId });
    expect(profile.username).toBe("   MiXedCase_Name  ");

    const stored = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntPublicProfiles").withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", jellyUserId)).unique(),
    );
    expect(stored.normalizedUsername).toBe("mixedcase_name");
  });

  it("trims opaque Jelly user IDs without changing their case", async () => {
    const suffix = uniqueSuffix();
    const jellyUserId = `OpaqueUser_${suffix}`;
    const now = Date.now();

    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId: `  ${jellyUserId}  `,
      username: "CasePreserved",
      accountState: "active",
      now,
    });

    expect(await t.query(profiles.getPublicProfile, { jellyUserId })).toEqual({
      jellyUserId,
      username: "CasePreserved",
      refreshedAt: now,
    });
    expect(await t.query(profiles.getPublicProfile, { jellyUserId: jellyUserId.toLowerCase() })).toBeNull();
  });

  it("refreshes every existing leaderboard projection in the same profile mutation", async () => {
    const suffix = uniqueSuffix();
    const jellyUserId = `user_${suffix}`;
    const now = Date.now();

    await t.run(async (ctx: any) => {
      await ctx.db.insert("jellyhuntProgramConfig", {
        publicId: `cfg_${suffix}`,
        singletonKey: "default",
        leaderboardLaunchEpoch: now - 1000,
        leaderboardRevision: 3,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("jellyhuntLeaderboardEntries", {
        publicId: `lbe_${suffix}`,
        scopeKey: "all_time",
        jellyUserId,
        approvedMissionCount: 2,
        rankSortScore: -2,
        normalizedUsername: "oldname",
        scoreReachedAt: now - 500,
        publicEligible: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(profiles.upsertPublicProfile, {
      jellyUserId,
      username: "  ÅLICE  ",
      accountState: "active",
      jellyProfileRevision: 9,
      now: now + 1000,
    });

    const state = await t.run(async (ctx: any) => ({
      entry: await ctx.db
        .query("jellyhuntLeaderboardEntries")
        .withIndex("by_scope_user", (q: any) =>
          q.eq("scopeKey", "all_time").eq("jellyUserId", jellyUserId),
        )
        .unique(),
      config: await ctx.db
        .query("jellyhuntProgramConfig")
        .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
        .unique(),
    }));

    expect(state.entry).toMatchObject({
      normalizedUsername: "ålice",
      publicEligible: true,
      profileRevision: 9,
    });
    expect(state.config.leaderboardRevision).toBe(4);
  });
});
