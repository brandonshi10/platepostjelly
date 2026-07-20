import type { z } from "zod";
import {
  MissionListQuery,
  MissionPublic,
  MissionSummary,
} from "@/src/lib/jellyhunt/v2/public-discovery-contracts";
import { computeQueryHash, openCursor, sealCursor } from "@/src/lib/jellyhunt/v2/cursor";
import { JellyhuntV2Error } from "@/src/lib/jellyhunt/v2/errors";
import { optionalJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { parseQuery, resourceNotFound } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";
import { listMissions } from "@/src/lib/jellyhunt/v2/repository";

type Mission = z.infer<typeof MissionPublic>;

function distanceMeters(
  latitude: number,
  longitude: number,
  placeLatitude: number,
  placeLongitude: number,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = radians(placeLatitude - latitude);
  const deltaLongitude = radians(placeLongitude - longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitude)) *
      Math.cos(radians(placeLatitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sortValues(
  mission: Mission,
  sort: "curated" | "nearby" | "updated",
  latitude?: number,
  longitude?: number,
): Array<string | number> {
  if (sort === "updated") return [-Date.parse(mission.updatedAt), mission.id];
  if (sort === "nearby" && latitude !== undefined && longitude !== undefined) {
    return [
      distanceMeters(latitude, longitude, mission.place.latitude, mission.place.longitude),
      mission.display.sortOrder,
      mission.id,
    ];
  }
  return [mission.display.sortOrder, mission.id];
}

function compareSortValues(left: Array<string | number>, right: Array<string | number>): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function toSummary(mission: Mission) {
  return MissionSummary.parse({
    id: mission.id,
    campaignId: mission.campaignId,
    revision: mission.revision,
    title: mission.title,
    availability: mission.availability,
    reward: mission.reward,
    display: mission.display,
    place: {
      id: mission.place.id,
      jellyPlaceId: mission.place.jellyPlaceId,
      name: mission.place.name,
      address: mission.place.address,
      latitude: mission.place.latitude,
      longitude: mission.place.longitude,
      timeZone: mission.place.timeZone,
    },
    ...(mission.viewer ? { viewer: mission.viewer } : {}),
    links: {
      self: `/api/v2/jellyhunt/missions/${mission.id}`,
      start: `https://platepost.io/human-social/missions/${mission.id}/start`,
    },
    updatedAt: mission.updatedAt,
  });
}

export const GET = createV2Handler(
  async (request) => {
    const query = parseQuery(request, MissionListQuery);
    const authenticatedViewer = await optionalJellyViewer(request, "jellyhunt:read");
    if (query.include === "viewer" && !authenticatedViewer) {
      throw new JellyhuntV2Error(401, "authentication_required", "Authentication is required.");
    }

    const result = await listMissions({
      campaignPublicId: query.campaignId,
      jellyUserId: query.include === "viewer" ? authenticatedViewer?.jellyUserId : undefined,
      now: Date.now(),
    });
    if (!result) throw resourceNotFound("campaign");

    let missions: Mission[] = (result.missions as unknown[]).map((mission) => MissionPublic.parse(mission));
    missions = missions.filter(
      (mission) =>
        mission.availability.state !== "archived" &&
        query.availability.includes(mission.availability.state),
    );
    if (query.category) missions = missions.filter((mission) => mission.display.category === query.category);
    if (query.difficulty) missions = missions.filter((mission) => mission.display.difficulty === query.difficulty);
    if (query.latitude !== undefined && query.longitude !== undefined && query.radiusMeters !== undefined) {
      missions = missions.filter(
        (mission) =>
          distanceMeters(
            query.latitude!,
            query.longitude!,
            mission.place.latitude,
            mission.place.longitude,
          ) <= query.radiusMeters!,
      );
    }

    missions.sort((left, right) =>
      compareSortValues(
        sortValues(left, query.sort, query.latitude, query.longitude),
        sortValues(right, query.sort, query.latitude, query.longitude),
      ),
    );

    const queryHash = await computeQueryHash({
      campaignId: query.campaignId ?? null,
      availability: query.availability,
      category: query.category ?? null,
      difficulty: query.difficulty ?? null,
      latitude: query.latitude ?? null,
      longitude: query.longitude ?? null,
      radiusMeters: query.radiusMeters ?? null,
      sort: query.sort,
      include: query.include ?? null,
    });
    const snapshot = String(result.catalogRevision);
    let startIndex = 0;
    if (query.cursor) {
      const cursor = await openCursor(query.cursor, {
        resource: "mission_catalog",
        subject: query.include === "viewer" ? authenticatedViewer?.jellyUserId : undefined,
        queryHash,
        limit: query.limit,
        snapshot,
      });
      const found = missions.findIndex(
        (mission) =>
          compareSortValues(
            sortValues(mission, query.sort, query.latitude, query.longitude),
            cursor.lastSortValues,
          ) === 0,
      );
      if (found < 0) {
        throw new JellyhuntV2Error(400, "invalid_cursor", "Cursor is invalid or no longer usable");
      }
      startIndex = found + 1;
    }

    const pageMissions = missions.slice(startIndex, startIndex + query.limit);
    const hasMore = startIndex + pageMissions.length < missions.length;
    const last = pageMissions.at(-1);
    const nextCursor =
      hasMore && last
        ? await sealCursor({
            version: 1,
            resource: "mission_catalog",
            ...(query.include === "viewer" && authenticatedViewer
              ? {
                  subjectHash: await import("@/src/lib/jellyhunt/v2/cursor").then(({ hashCursorSubject }) =>
                    hashCursorSubject(authenticatedViewer.jellyUserId),
                  ),
                }
              : {}),
            queryHash,
            limit: query.limit,
            snapshot,
            lastSortValues: sortValues(last, query.sort, query.latitude, query.longitude),
            issuedAt: Date.now(),
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          })
        : null;

    return {
      data: { missions: pageMissions.map(toSummary) },
      meta: {
        catalogRevision: result.catalogRevision,
        page: { limit: query.limit, nextCursor, hasMore },
      },
      cachePolicy: authenticatedViewer ? "private" : "public",
    };
  },
  { cachePolicy: "public", maxAge: 30, staleWhileRevalidate: 120, etag: true },
);
