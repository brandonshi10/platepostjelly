import { describe, expect, it } from "vitest";
import { missionsResponseSchema } from "../src/lib/jellyhunt/contracts";

const mission = {
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
  hours: [
    "11:00-22:00",
    "11:00-22:00",
    "11:00-22:00",
    "11:00-23:00",
    "11:00-23:00",
    "12:00-23:00",
    "closed",
  ],
  sortOrder: 10,
  location: {
    id: "loc_123",
    jellyRestaurantId: "restaurant_123",
    name: "Demo Sushi",
    address: "123 Main St",
    latitude: 34.0522,
    longitude: -118.2437,
    geofenceRadiusMeters: 75,
  },
};

describe("Jellyhunt API contracts", () => {
  it("retains every field the native and web maps render", () => {
    const parsed = missionsResponseSchema.parse({
      apiVersion: "1.0",
      generatedAt: "2026-07-15T12:00:00.000Z",
      missions: [mission],
      userStatus: [{ missionId: "mission_123", status: "not_started" }],
    });

    expect(parsed.apiVersion).toBe("1.0");
    expect(parsed.missions[0]).toMatchObject({
      category: "Sushi",
      difficulty: "easy",
      emoji: "🍣",
      neighborhood: "Downtown",
      hours: expect.arrayContaining(["11:00-22:00", "closed"]),
      sortOrder: 10,
    });
  });

  it("rejects missions without coordinates", () => {
    const result = missionsResponseSchema.safeParse({
      apiVersion: "1.0",
      generatedAt: "2026-07-15T12:00:00.000Z",
      missions: [{ ...mission, location: { id: "loc_123", name: "Demo Sushi", geofenceRadiusMeters: 75 } }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects coordinates outside valid latitude and longitude bounds", () => {
    const result = missionsResponseSchema.safeParse({
      apiVersion: "1.0",
      generatedAt: "2026-07-15T12:00:00.000Z",
      missions: [{ ...mission, location: { ...mission.location, latitude: 134.0522 } }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed weekly hours", () => {
    const result = missionsResponseSchema.safeParse({
      apiVersion: "1.0",
      generatedAt: "2026-07-15T12:00:00.000Z",
      missions: [{ ...mission, hours: ["11:00-22:00"] }],
    });

    expect(result.success).toBe(false);
  });
});
