import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Convex Jellyhunt security boundary", () => {
  it("keeps verification and reward transport internal to Convex", () => {
    const jelly = read("convex/jelly.ts");

    expect(jelly).toContain("internalAction");
    expect(jelly).not.toMatch(/export const sendReward\s*=\s*action/);
    expect(jelly).toMatch(/sendReward[\s\S]*args:\s*{\s*rewardAttemptId:/);
    expect(jelly).not.toMatch(/sendReward[\s\S]*amount:\s*v\.number\(\)/);
  });

  it("requires the server service key for private mission and submission functions", () => {
    const missions = read("convex/missions.ts");
    const submissions = read("convex/submissions.ts");

    expect(missions).toContain("assertServiceKey");
    expect(submissions).toContain("assertServiceKey");
    expect(submissions).toContain("ctx.scheduler.runAfter");
  });

  it("checks mission siblings before reverify, approval, and reward queue", () => {
    const submissions = read("convex/submissions.ts");
    expect(submissions.match(/await assertNoBlockingMissionSibling/g) ?? []).toHaveLength(3);
  });

  it("moves an abandoned processing reward into reconciliation", () => {
    const submissions = read("convex/submissions.ts");
    expect(submissions).toMatch(/markRewardProcessing[\s\S]*runAfter\(\s*REWARD_PROCESSING_LEASE_MS,\s*internal\.submissions\.markStaleRewardUncertain/);
    expect(submissions).toMatch(/markStaleRewardUncertain[\s\S]*status: "uncertain"[\s\S]*status: "reward_uncertain"/);
  });

  it("revalidates the current reward ceiling before activation", () => {
    const missions = read("convex/missions.ts");
    expect(missions).toMatch(/updateMissionStatus[\s\S]*args\.status === "active"[\s\S]*validateMissionInput\(mission, missionValidationOptions\(\)\)/);
  });

  it("never stores arbitrary reward response bodies", () => {
    expect(read("convex/jelly.ts")).not.toContain("responseJson");
    expect(read("convex/submissions.ts")).not.toContain("responseJson");
    expect(read("convex/schema.ts")).not.toContain("responseJson");
  });
});
