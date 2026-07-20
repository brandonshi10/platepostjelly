import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("JellyHunt canonical Convex cutover", () => {
  it("routes v1 map and admin traffic to namespaced jellyhunt functions", () => {
    const repository = readFileSync("src/lib/jellyhunt/convex-repository.ts", "utf8");

    expect(repository).toContain("anyApi.jellyhunt.admin");
    expect(repository).toContain("anyApi.jellyhunt.approvals");
    expect(repository).not.toContain("anyApi.missions.");
    expect(repository).not.toContain("anyApi.submissions.");
    expect(repository).not.toContain("anyApi.audit.");
  });

  it("does not offer an unsafe verification retry for terminal rejections", () => {
    const dashboard = readFileSync("app/admin/admin-dashboard.tsx", "utf8");

    expect(dashboard).not.toContain(
      '["submitted", "verifying", "needs_review", "rejected"].includes',
    );
  });
  it("delegates approvals to the canonical approval transaction", () => {
    const route = readFileSync(
      "app/api/v1/jellyhunt/admin/submissions/route.ts",
      "utf8",
    );

    expect(route).toContain('callAdminMutation("approvals", "approveSubmission"');
    expect(route).not.toContain('"adminReviewSubmission"');
  });
});