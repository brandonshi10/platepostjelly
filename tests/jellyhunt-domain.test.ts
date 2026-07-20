import { describe, expect, it } from "vitest";
import {
  createDedupeKey,
  isMissionVisible,
  nextSubmissionStatus,
  submissionConflictCode,
} from "../src/lib/jellyhunt/domain";
import type { JellyhuntMission } from "../src/lib/jellyhunt/contracts";

const mission: JellyhuntMission = {
  id: "mission_123",
  slug: "demo-sushi-post",
  title: "Post a jelly at Demo Sushi",
  description: "Create a Jelly post while visiting Demo Sushi.",
  status: "active",
  approvalMode: "manual",
  rewardAmount: 250,
  rewardToken: "JELLY-MY-JELLY",
  restaurantTag: "demo-sushi",
  category: "Sushi",
  difficulty: "easy",
  emoji: "🍣",
  neighborhood: "Downtown",
  price: "$$",
  hours: ["09:00-22:00", "09:00-22:00", "09:00-22:00", "09:00-22:00", "09:00-22:00", "09:00-22:00", "09:00-22:00"],
  sortOrder: 1,
  location: {
    id: "loc_123",
    jellyRestaurantId: "restaurant_123",
    name: "Demo Sushi",
    address: "123 Main St",
    latitude: 34.0522,
    longitude: -118.2437,
    geofenceRadiusMeters: 75,
    timeZone: "America/Los_Angeles",
  },
};

describe("Jellyhunt domain behavior", () => {
  it("classifies known Convex deduplication conflicts", () => {
    expect(submissionConflictCode("Jelly post already used for a mission")).toBe("jelly_post_reused");
    expect(submissionConflictCode("Mission already submitted by this user")).toBe("mission_already_submitted");
    expect(submissionConflictCode("Convex timed out")).toBeNull();
  });
  it("creates stable dedupe keys from mission user and post ids", () => {
    expect(
      createDedupeKey({
        missionId: " Mission_123 ",
        jellyUserId: " User_456 ",
        jellyPostId: " Post_789 ",
      }),
    ).toBe("mission_123:user_456:post_789");
  });

  it("requires admin review when manual verification passes", () => {
    expect(
      nextSubmissionStatus("submitted", {
        type: "verification_passed",
        approvalMode: "manual",
      }),
    ).toBe("needs_review");
  });

  it("approves immediately when automatic verification passes", () => {
    expect(
      nextSubmissionStatus("submitted", {
        type: "verification_passed",
        approvalMode: "automatic",
      }),
    ).toBe("approved");
  });

  it("prevents impossible submission transitions", () => {
    expect(() =>
      nextSubmissionStatus("reward_sent", { type: "admin_rejected" }),
    ).toThrow("Cannot apply admin_rejected to reward_sent");
  });
  it("does not let stale automatic verification downgrade a completed reward", () => {
    expect(() =>
      nextSubmissionStatus("reward_sent", {
        type: "verification_passed",
        approvalMode: "automatic",
      }),
    ).toThrow("Cannot apply verification_passed to reward_sent");
  });

  it("shows active missions inside their date window", () => {
    expect(
      isMissionVisible(
        {
          ...mission,
          startsAt: "2026-07-01T00:00:00.000Z",
          endsAt: "2026-08-01T00:00:00.000Z",
        },
        new Date("2026-07-15T12:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("hides inactive or expired missions", () => {
    expect(isMissionVisible({ ...mission, status: "draft" })).toBe(false);
    expect(
      isMissionVisible(
        { ...mission, endsAt: "2026-07-01T00:00:00.000Z" },
        new Date("2026-07-15T12:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
