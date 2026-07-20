import { describe, expect, it } from "vitest";
import * as domain from "../src/lib/jellyhunt/domain";
import type { JellyhuntMission, UserMissionStatus } from "../src/lib/jellyhunt/contracts";

const mission = {
  id: "mission_sushi",
  slug: "demo-sushi",
  title: "Post at Demo Sushi",
  description: "Film the chef finishing one dish.",
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
  hours: ["11:00-22:00", "11:00-22:00", "11:00-22:00", "11:00-22:00", "11:00-02:00", "closed", "closed"],
  sortOrder: 1,
  location: {
    id: "loc_sushi",
    name: "Demo Sushi",
    address: "123 Main St",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
  },
} as JellyhuntMission;

const mapDomain = domain as typeof domain & {
  haversineDistanceMeters: (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) => number;
  getMissionOpenState: (hours: string[], at: Date, timeZone?: string) => "open" | "closed" | "unknown";
  filterMissions: (
    missions: JellyhuntMission[],
    filters: { query?: string; category?: string; status?: string },
    statuses?: UserMissionStatus[],
  ) => JellyhuntMission[];
};

describe("Jellyhunt map behavior", () => {
  it("calculates realistic distance between nearby mission coordinates", () => {
    const meters = mapDomain.haversineDistanceMeters(
      { latitude: 40.7163, longitude: -73.9914 },
      { latitude: 40.7172, longitude: -73.9914 },
    );

    expect(meters).toBeGreaterThan(95);
    expect(meters).toBeLessThan(105);
  });

  it("treats an overnight Friday schedule as open after midnight", () => {
    expect(
      mapDomain.getMissionOpenState(
        mission.hours,
        new Date("2026-07-18T01:00:00-04:00"),
      ),
    ).toBe("open");
  });

  it("finds missions by venue, neighborhood, category, or instruction", () => {
    for (const query of ["Demo Sushi", "lower east", "sushi", "chef"]) {
      expect(mapDomain.filterMissions([mission], { query })).toHaveLength(1);
    }
    expect(mapDomain.filterMissions([mission], { query: "pizza" })).toHaveLength(0);
  });

  it("filters missions using the user's current mission state", () => {
    const statuses: UserMissionStatus[] = [
      { missionId: mission.id, status: "needs_review", submissionId: "submission_1" },
    ];

    expect(mapDomain.filterMissions([mission], { status: "needs_review" }, statuses)).toEqual([mission]);
    expect(mapDomain.filterMissions([mission], { status: "not_started" }, statuses)).toEqual([]);
  });
});
