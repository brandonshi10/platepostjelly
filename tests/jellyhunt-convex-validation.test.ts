import { describe, expect, it } from "vitest";
import {
  validateLocationInput,
  validateMissionInput,
} from "../convex/validation";

const location = {
  name: "Demo Sushi",
  latitude: 40.7,
  longitude: -73.9,
  geofenceRadiusMeters: 75,
  timeZone: "America/New_York",
};

const mission = {
  slug: "demo-sushi",
  title: "Post at Demo Sushi",
  description: "Film a real moment at the restaurant.",
  restaurantTag: "demo-sushi",
  category: "Sushi",
  emoji: "🍣",
  approvalMode: "manual" as const,
  rewardAmount: 100,
  sortOrder: 1,
  hours: Array(7).fill("11:00-22:00") as string[],
  showtimes: ["19:30"],
  websiteUrl: "https://example.com",
};

describe("Convex mission input validation", () => {
  it("accepts a valid location and mission", () => {
    expect(() => validateLocationInput(location)).not.toThrow();
    expect(() => validateMissionInput(mission, { maxRewardAmount: 500, partnerVerificationConfigured: false })).not.toThrow();
  });

  it("rejects invalid timezone, hours, URL, sort order, and excess reward", () => {
    expect(() => validateLocationInput({ ...location, timeZone: "Mars/Olympus" })).toThrow("time zone");
    expect(() => validateMissionInput({ ...mission, hours: Array(7).fill("25:00-26:00") }, { maxRewardAmount: 500, partnerVerificationConfigured: true })).toThrow("hours");
    expect(() => validateMissionInput({ ...mission, websiteUrl: "javascript:alert(1)" }, { maxRewardAmount: 500, partnerVerificationConfigured: true })).toThrow("website");
    expect(() => validateMissionInput({ ...mission, sortOrder: -1 }, { maxRewardAmount: 500, partnerVerificationConfigured: true })).toThrow("sort order");
    expect(() => validateMissionInput({ ...mission, rewardAmount: 501 }, { maxRewardAmount: 500, partnerVerificationConfigured: true })).toThrow("maximum");
  });

  it("requires the authoritative partner verifier for automatic missions", () => {
    expect(() => validateMissionInput({ ...mission, approvalMode: "automatic" }, { maxRewardAmount: 500, partnerVerificationConfigured: false })).toThrow("partner verification");
  });
});
