import { describe, expect, it } from "vitest";
import { groupMissionsIntoVenues } from "../src/lib/jellyhunt/venues";
import type { JellyhuntMission } from "../src/lib/jellyhunt/contracts";

function mission(overrides: Partial<JellyhuntMission> = {}): JellyhuntMission {
  return {
    id: "mis_1",
    slug: "supermoon-bakehouse-ube-eclair",
    title: "Ube Eclair",
    description: "Film the eclair.",
    status: "active",
    approvalMode: "manual",
    rewardAmount: 10,
    rewardToken: "JELLY-MY-JELLY",
    restaurantTag: "supermoon-bakehouse",
    category: "Bakery",
    difficulty: "easy",
    emoji: "🥐",
    neighborhood: "Lower East Side",
    price: "$$",
    hours: [
      "08:00-18:00", "08:00-18:00", "08:00-18:00", "08:00-18:00",
      "08:00-19:00", "08:00-19:00", "08:00-18:00",
    ],
    sortOrder: 0,
    location: {
      id: "plc_supermoon",
      name: "Supermoon Bakehouse",
      address: "120 Rivington St",
      latitude: 40.7188,
      longitude: -73.9877,
      geofenceRadiusMeters: 75,
      timeZone: "America/New_York",
    },
    ...overrides,
  } as JellyhuntMission;
}

describe("groupMissionsIntoVenues", () => {
  it("collapses missions that share a place into one venue", () => {
    const venues = groupMissionsIntoVenues([
      mission({ id: "mis_1", sortOrder: 0 }),
      mission({ id: "mis_2", slug: "supermoon-corn-cookie", title: "Corn Cookie", sortOrder: 1 }),
      mission({ id: "mis_3", slug: "supermoon-case", title: "Pastry Case Reveal", sortOrder: 2 }),
    ]);

    expect(venues).toHaveLength(1);
    expect(venues[0].id).toBe("plc_supermoon");
    expect(venues[0].name).toBe("Supermoon Bakehouse");
    expect(venues[0].missions.map((m) => m.title)).toEqual([
      "Ube Eclair",
      "Corn Cookie",
      "Pastry Case Reveal",
    ]);
  });

  it("orders missions inside a venue by sortOrder regardless of input order", () => {
    const venues = groupMissionsIntoVenues([
      mission({ id: "mis_3", slug: "c", title: "Third", sortOrder: 22 }),
      mission({ id: "mis_1", slug: "a", title: "First", sortOrder: 20 }),
      mission({ id: "mis_2", slug: "b", title: "Second", sortOrder: 21 }),
    ]);

    expect(venues[0].missions.map((m) => m.title)).toEqual(["First", "Second", "Third"]);
  });

  it("caps a venue at the sum of its missions, not a flat fifty", () => {
    const three = groupMissionsIntoVenues([
      mission({ id: "mis_1", slug: "a", sortOrder: 0 }),
      mission({ id: "mis_2", slug: "b", sortOrder: 1 }),
      mission({ id: "mis_3", slug: "c", sortOrder: 2 }),
    ]);
    expect(three[0].rewardTotal).toBe(30);

    const five = groupMissionsIntoVenues(
      [0, 1, 2, 3, 4].map((i) => mission({ id: `mis_${i}`, slug: `s${i}`, sortOrder: i })),
    );
    expect(five[0].rewardTotal).toBe(50);
  });

  it("keeps separate places separate and orders venues by their first mission", () => {
    const venues = groupMissionsIntoVenues([
      mission({
        id: "mis_9",
        slug: "fournil-canele",
        sortOrder: 9,
        location: { ...mission().location, id: "plc_fournil", name: "Le Fournil" },
      }),
      mission({ id: "mis_1", sortOrder: 1 }),
    ]);

    expect(venues.map((v) => v.name)).toEqual(["Supermoon Bakehouse", "Le Fournil"]);
  });

  it("takes the pin emoji from the lowest-sortOrder mission", () => {
    const venues = groupMissionsIntoVenues([
      mission({ id: "mis_2", slug: "b", sortOrder: 5, emoji: "🍪" }),
      mission({ id: "mis_1", slug: "a", sortOrder: 1, emoji: "🥐" }),
    ]);
    expect(venues[0].emoji).toBe("🥐");
  });

  it("returns nothing for no missions", () => {
    expect(groupMissionsIntoVenues([])).toEqual([]);
  });
});
