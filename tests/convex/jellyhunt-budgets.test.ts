import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const budgets = anyApi.jellyhunt.budgets;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

async function allocate(
  t: any,
  scopeType: "campaign" | "mission" | "day" | "user",
  scopeKey: string,
  allocatedAmount: string,
) {
  return t.mutation(budgets.setBudgetAllocation, {
    serviceKey: TEST_SERVICE_KEY,
    scopeType,
    scopeKey,
    allocatedAmount,
    expectedRevision: 0,
  });
}

describe("reward budgets", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates one zero-allocation budget per scope", async () => {
    const scopeKey = `campaign_${uniqueSuffix()}`;
    const budget = await t.mutation(budgets.getOrCreateBudget, {
      scopeType: "campaign",
      scopeKey,
    });

    expect(budget).toMatchObject({
      allocatedAmount: "0",
      reservedAmount: "0",
      paidAmount: "0",
      releasedAmount: "0",
      revision: 0,
    });

    const again = await t.mutation(budgets.getOrCreateBudget, {
      scopeType: "campaign",
      scopeKey,
    });
    expect(again._id).toBe(budget._id);
  });

  it("uses exact six-decimal arithmetic when reserving", async () => {
    const scopeKey = `mission_${uniqueSuffix()}`;
    await allocate(t, "mission", scopeKey, "1");

    const first = await t.mutation(budgets.reserveBudgetAmount, {
      serviceKey: TEST_SERVICE_KEY,
      scopeType: "mission",
      scopeKey,
      amount: "0.000001",
    });
    expect(first.reservedAmount).toBe("0.000001");

    const second = await t.mutation(budgets.reserveBudgetAmount, {
      serviceKey: TEST_SERVICE_KEY,
      scopeType: "mission",
      scopeKey,
      amount: "0.000002",
    });
    expect(second.reservedAmount).toBe("0.000003");
  });

  it("moves only an actually reserved amount to released", async () => {
    const scopeKey = `mission_${uniqueSuffix()}`;
    await allocate(t, "mission", scopeKey, "100");
    await t.mutation(budgets.reserveBudgetAmount, {
      serviceKey: TEST_SERVICE_KEY,
      scopeType: "mission",
      scopeKey,
      amount: "20",
    });

    const released = await t.mutation(budgets.releaseBudgetAmount, {
      serviceKey: TEST_SERVICE_KEY,
      scopeType: "mission",
      scopeKey,
      amount: "8",
    });

    expect(released.reservedAmount).toBe("12");
    expect(released.releasedAmount).toBe("8");

    await expect(
      t.mutation(budgets.releaseBudgetAmount, {
        serviceKey: TEST_SERVICE_KEY,
        scopeType: "mission",
        scopeKey,
        amount: "13",
      }),
    ).rejects.toThrow("release_exceeds_reserved");
  });

  it("refuses reservations until capacity is explicitly allocated", async () => {
    const scopeKey = `campaign_${uniqueSuffix()}`;
    await expect(
      t.mutation(budgets.reserveBudgetAmount, {
        serviceKey: TEST_SERVICE_KEY,
        scopeType: "campaign",
        scopeKey,
        amount: "1",
      }),
    ).rejects.toThrow("budget_not_allocated");
  });

  it("rejects a reservation above remaining allocation", async () => {
    const scopeKey = `mission_${uniqueSuffix()}`;
    await allocate(t, "mission", scopeKey, "10");

    await expect(
      t.mutation(budgets.reserveBudgetAmount, {
        serviceKey: TEST_SERVICE_KEY,
        scopeType: "mission",
        scopeKey,
        amount: "20",
      }),
    ).rejects.toThrow("budget_exceeded");
  });

  it("moves reserved capacity to paid without changing total committed", async () => {
    const scopeKey = `mission_${uniqueSuffix()}`;
    await allocate(t, "mission", scopeKey, "100");
    await t.mutation(budgets.reserveBudgetAmount, {
      serviceKey: TEST_SERVICE_KEY,
      scopeType: "mission",
      scopeKey,
      amount: "60",
    });

    const paid = await t.mutation(budgets.markBudgetPaid, {
      serviceKey: TEST_SERVICE_KEY,
      scopeType: "mission",
      scopeKey,
      amount: "60",
    });
    expect(paid.reservedAmount).toBe("0");
    expect(paid.paidAmount).toBe("60");
  });

  it.each(["", "-1", "0", "01", "1.0", "0.0000001", "NaN", "Infinity"])(
    "rejects non-canonical or non-positive operation amount %j",
    async (amount) => {
      const scopeKey = `mission_${uniqueSuffix()}`;
      await allocate(t, "mission", scopeKey, "100");
      await expect(
        t.mutation(budgets.reserveBudgetAmount, {
          serviceKey: TEST_SERVICE_KEY,
          scopeType: "mission",
          scopeKey,
          amount,
        }),
      ).rejects.toThrow("invalid_reward_amount_format");
    },
  );

  it("uses optimistic concurrency when changing allocation", async () => {
    const scopeKey = `mission_${uniqueSuffix()}`;
    const first = await allocate(t, "mission", scopeKey, "100");
    expect(first.revision).toBe(1);

    await expect(
      t.mutation(budgets.setBudgetAllocation, {
        serviceKey: TEST_SERVICE_KEY,
        scopeType: "mission",
        scopeKey,
        allocatedAmount: "200",
        expectedRevision: 0,
      }),
    ).rejects.toThrow("budget_revision_conflict");
  });

  it("cannot lower allocation below reserved plus paid", async () => {
    const scopeKey = `mission_${uniqueSuffix()}`;
    await allocate(t, "mission", scopeKey, "100");
    const reserved = await t.mutation(budgets.reserveBudgetAmount, {
      serviceKey: TEST_SERVICE_KEY,
      scopeType: "mission",
      scopeKey,
      amount: "60",
    });

    await expect(
      t.mutation(budgets.setBudgetAllocation, {
        serviceKey: TEST_SERVICE_KEY,
        scopeType: "mission",
        scopeKey,
        allocatedAmount: "50",
        expectedRevision: reserved.revision,
      }),
    ).rejects.toThrow("allocation_below_committed");
  });

  it("serializes competing reservations at the allocation boundary", async () => {
    const scopeKey = `mission_${uniqueSuffix()}`;
    await allocate(t, "mission", scopeKey, "100");

    const results = await Promise.allSettled([
      t.mutation(budgets.reserveBudgetAmount, {
        serviceKey: TEST_SERVICE_KEY,
        scopeType: "mission",
        scopeKey,
        amount: "60",
      }),
      t.mutation(budgets.reserveBudgetAmount, {
        serviceKey: TEST_SERVICE_KEY,
        scopeType: "mission",
        scopeKey,
        amount: "60",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
