import {
  computeQueryHash,
  hashCursorSubject,
  openCursor,
  sealCursor,
} from "@/src/lib/jellyhunt/v2/cursor";
import { invalidCursor } from "@/src/lib/jellyhunt/v2/errors";
import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { MyMissionsQuery } from "@/src/lib/jellyhunt/v2/owner-read-contracts";
import {
  createOwnerReadHandler,
  expectNumberSortValue,
  expectStringSortValue,
  myMissionItem,
  ownerResourceNotFound,
  OWNER_CURSOR_TTL_MS,
} from "@/src/lib/jellyhunt/v2/owner-read-route";
import { parseQuery } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { listMyMissions } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createOwnerReadHandler(async (request) => {
  const viewer = await requireJellyViewer(request, "jellyhunt:read");
  const query = parseQuery(request, MyMissionsQuery);
  const queryHash = await computeQueryHash({
    campaignId: query.campaignId ?? null,
    participationStatus: query.participationStatus ?? null,
    sort: "updated_at_desc_mission_id_asc",
    limit: query.limit,
  });

  let asOf: number | undefined;
  let beforeUpdatedAt: number | undefined;
  let beforeMissionPublicId: string | undefined;
  let openedSnapshot: string | undefined;
  if (query.cursor) {
    const cursor = await openCursor(query.cursor, {
      resource: "me_missions",
      subject: viewer.jellyUserId,
      queryHash,
      limit: query.limit,
      scopeKey: query.campaignId,
    });
    openedSnapshot = cursor.snapshot;
    asOf = Number(cursor.snapshot);
    if (!Number.isSafeInteger(asOf) || asOf < 0 || cursor.lastSortValues.length !== 2) {
      throw invalidCursor();
    }
    beforeUpdatedAt = expectNumberSortValue(cursor.lastSortValues[0]);
    beforeMissionPublicId = expectStringSortValue(cursor.lastSortValues[1]);
  }

  const page = await listMyMissions({
    jellyUserId: viewer.jellyUserId,
    campaignPublicId: query.campaignId,
    participationStatus: query.participationStatus,
    limit: query.limit,
    now: Date.now(),
    asOf,
    beforeUpdatedAt,
    beforeMissionPublicId,
  });
  if (!page) throw ownerResourceNotFound("campaign");
  if (openedSnapshot !== undefined && String(page.asOf) !== openedSnapshot) {
    throw invalidCursor();
  }

  const missions = (page.items as unknown[]).map(myMissionItem);
  let nextCursor: string | null = null;
  if (page.hasMore) {
    if (typeof page.nextUpdatedAt !== "number" || !page.nextMissionPublicId) {
      throw new Error("invalid_owner_page");
    }
    const issuedAt = Date.now();
    nextCursor = await sealCursor({
      version: 1,
      resource: "me_missions",
      subjectHash: await hashCursorSubject(viewer.jellyUserId),
      queryHash,
      limit: query.limit,
      ...(query.campaignId ? { scopeKey: query.campaignId } : {}),
      snapshot: String(page.asOf),
      lastSortValues: [page.nextUpdatedAt, page.nextMissionPublicId],
      issuedAt,
      expiresAt: issuedAt + OWNER_CURSOR_TTL_MS,
    });
  }

  return {
    data: { missions },
    meta: {
      page: { limit: query.limit, nextCursor, hasMore: Boolean(page.hasMore) },
    },
  };
});
