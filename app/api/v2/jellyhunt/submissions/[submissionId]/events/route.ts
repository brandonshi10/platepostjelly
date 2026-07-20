import {
  computeQueryHash,
  hashCursorSubject,
  openCursor,
  sealCursor,
} from "@/src/lib/jellyhunt/v2/cursor";
import { invalidCursor } from "@/src/lib/jellyhunt/v2/errors";
import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import {
  SubmissionEventsQuery,
  SubmissionParams,
  TimelineEntry,
} from "@/src/lib/jellyhunt/v2/owner-read-contracts";
import {
  createOwnerReadHandler,
  expectNumberSortValue,
  ownerResourceNotFound,
  OWNER_CURSOR_TTL_MS,
} from "@/src/lib/jellyhunt/v2/owner-read-route";
import { parseQuery, parseRouteParams } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { listSubmissionEvents } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createOwnerReadHandler(
  async (request, _requestId, context) => {
    const viewer = await requireJellyViewer(request, "jellyhunt:read");
    const query = parseQuery(request, SubmissionEventsQuery);
    const { submissionId } = await parseRouteParams(context, SubmissionParams);
    const queryHash = await computeQueryHash({
      submissionId,
      sort: "sequence_desc",
      limit: query.limit,
    });

    let asOfSequence: number | undefined;
    let beforeSequence: number | undefined;
    let openedSnapshot: string | undefined;
    if (query.cursor) {
      const cursor = await openCursor(query.cursor, {
        resource: "submission_events",
        subject: viewer.jellyUserId,
        queryHash,
        limit: query.limit,
        scopeKey: submissionId,
      });
      openedSnapshot = cursor.snapshot;
      asOfSequence = Number(cursor.snapshot);
      if (
        !Number.isSafeInteger(asOfSequence) ||
        asOfSequence < 0 ||
        cursor.lastSortValues.length !== 1
      ) {
        throw invalidCursor();
      }
      beforeSequence = expectNumberSortValue(cursor.lastSortValues[0]);
    }

    const page = await listSubmissionEvents({
      jellyUserId: viewer.jellyUserId,
      submissionPublicId: submissionId,
      limit: query.limit,
      asOfSequence,
      beforeSequence,
    });
    if (!page) throw ownerResourceNotFound("submission");
    if (openedSnapshot !== undefined && String(page.asOfSequence) !== openedSnapshot) {
      throw invalidCursor();
    }

    const events = (page.events as unknown[]).map((event) => TimelineEntry.parse(event));
    let nextCursor: string | null = null;
    if (page.hasMore) {
      if (typeof page.nextBeforeSequence !== "number") throw new Error("invalid_owner_page");
      const issuedAt = Date.now();
      nextCursor = await sealCursor({
        version: 1,
        resource: "submission_events",
        subjectHash: await hashCursorSubject(viewer.jellyUserId),
        queryHash,
        limit: query.limit,
        scopeKey: submissionId,
        snapshot: String(page.asOfSequence),
        lastSortValues: [page.nextBeforeSequence],
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
  },
);
