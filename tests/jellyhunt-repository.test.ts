import { describe, expect, it } from "vitest";
import * as domain from "../src/lib/jellyhunt/domain";

const repository = domain as typeof domain & {
  mapConvexMission: (value: Record<string, unknown>) => Record<string, unknown>;
};

const rawMission = {
  _id: "mission_123",
  _creationTime: 1_752_580_800_000,
  slug: "demo-sushi",
  title: "Post at Demo Sushi",
  description: "Film one dish.",
  status: "active",
  approvalMode: "manual",
  rewardAmount: 60,
  rewardToken: "JELLY-MY-JELLY",
  restaurantTag: "demo-sushi",
  category: "Sushi",
  difficulty: "easy",
  emoji: "🍣",
  neighborhood: "Lower East Side",
  price: "$$",
  hours: ["11:00-22:00", "11:00-22:00", "11:00-22:00", "11:00-22:00", "11:00-23:00", "12:00-23:00", "closed"],
  sortOrder: 1,
  startsAt: 1_752_494_400_000,
  endsAt: 1_755_172_800_000,
  location: {
    _id: "location_123",
    _creationTime: 1_752_580_800_000,
    name: "Demo Sushi",
    address: "123 Main St",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
    timeZone: "America/New_York",
  },
};

describe("Convex mission mapping", () => {
  it("maps Convex ids and timestamps into the stable native contract", () => {
    const mission = repository.mapConvexMission(rawMission);

    expect(mission).toMatchObject({
      id: "mission_123",
      startsAt: "2025-07-14T12:00:00.000Z",
      endsAt: "2025-08-14T12:00:00.000Z",
      location: {
        id: "location_123",
        timeZone: "America/New_York",
      },
    });
    expect(mission).not.toHaveProperty("_id");
  });

  it("rejects a mission whose location was deleted", () => {
    expect(() => repository.mapConvexMission({ ...rawMission, location: null })).toThrow(
      "Mission mission_123 has no location",
    );
  });
});
