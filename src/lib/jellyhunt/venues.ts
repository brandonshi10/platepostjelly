import type { JellyhuntMission } from "./contracts";

/**
 * A restaurant and the missions filmed there.
 *
 * Derived, never stored. Missions already carry the place they belong to, so
 * grouping by `location.id` needs no new database field — which matters,
 * because an undeclared JellyHunt field has taken the restaurant platform
 * down twice.
 */
export type Venue = {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  neighborhood: string;
  category: string;
  emoji: string;
  missions: JellyhuntMission[];
  rewardTotal: number;
};

export function groupMissionsIntoVenues(missions: JellyhuntMission[]): Venue[] {
  const byPlace = new Map<string, JellyhuntMission[]>();

  for (const mission of missions) {
    const existing = byPlace.get(mission.location.id);
    if (existing) existing.push(mission);
    else byPlace.set(mission.location.id, [mission]);
  }

  const venues: Venue[] = [];
  for (const [id, group] of byPlace) {
    const ordered = [...group].sort((a, b) => a.sortOrder - b.sortOrder);
    // The lead mission supplies the pin's identity: its emoji, and the
    // venue-level fields that are per-mission in the contract but in practice
    // identical across a restaurant's missions.
    const lead = ordered[0];
    venues.push({
      id,
      name: lead.location.name,
      address: lead.location.address,
      latitude: lead.location.latitude,
      longitude: lead.location.longitude,
      timeZone: lead.location.timeZone,
      neighborhood: lead.neighborhood,
      category: lead.category,
      emoji: lead.emoji,
      missions: ordered,
      // The cap follows the missions. A three-mission venue is worth 30, not 50.
      rewardTotal: ordered.reduce((sum, mission) => sum + mission.rewardAmount, 0),
    });
  }

  return venues.sort((a, b) => a.missions[0].sortOrder - b.missions[0].sortOrder);
}
