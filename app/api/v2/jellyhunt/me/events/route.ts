import {
  computeQueryHash,
  hashCursorSubject,
  openCursor,
  sealCursor,
} from "@/src/lib/jellyhunt/v2/cursor";
import { invalidCursor } from "@/src/lib/jellyhunt/v2/errors";
import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { MyEventsQuery } from "@/src/lib/jellyhunt/v2/owner-read-contracts";
import {
  createOwnerReadHandler,
  expectNumberSortValue,
  myEventItem,
  OWNER_CURSOR_TTL_MS,
} from "@/src/lib/jellyhunt/v2/owner-read-route";
import { parseQuery } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { listMyEvents } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createOwnerReadHandler(async (request) => {
  const viewer = await requireJellyViewer(request, "jellyhunt:read");
  const query = parseQuery(request, MyEventsQuery);
  const queryHash = await computeQueryHash({ stream: "owner_events", limit: query.limit });
  let afterSequence: number | undefined;
  if (query.after) {
    const cursor = await openCursor(query.after, {
      resource: "me_events",
      subject: viewer.jellyUserId,
      queryHash,
      limit: query.limit,
      snapshot: "stream",
    });
    if (cursor.lastSortValues.length !== 1) throw invalidCursor();
    afterSequence = expectNumberSortValue(cursor.lastSortValues[0]);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw invalidCursor();
  }

  const page = await listMyEvents({
    jellyUserId: viewer.jellyUserId,
    afterSequence,
    limit: query.limit,
  });
  const events = (page.events as unknown[]).map(myEventItem);
  let nextCursor: string | null = query.after ?? null;
  if (typeof page.nextAfterSequence === "number") {
    const issuedAt = Date.now();
    nextCursor = await sealCursor({
      version: 1,
      resource: "me_events",
      subjectHash: await hashCursorSubject(viewer.jellyUserId),
      queryHash,
      limit: query.limit,
      snapshot: "stream",
      lastSortValues: [page.nextAfterSequence],
      issuedAt,
      expiresAt: issuedAt + OWNER_CURSOR_TTL_MS,
    });
  }

  return {
    data: { events },
    meta: {
      page: { limit: query.limit, nextCursor, hasMore: Boolean(page.hasMore) },
    },
  };
});
