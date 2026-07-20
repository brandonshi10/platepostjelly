import {
  computeQueryHash,
  hashCursorSubject,
  openCursor,
  sealCursor,
} from "@/src/lib/jellyhunt/v2/cursor";
import { invalidCursor } from "@/src/lib/jellyhunt/v2/errors";
import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { MySubmissionsQuery } from "@/src/lib/jellyhunt/v2/owner-read-contracts";
import {
  createOwnerReadHandler,
  expectNumberSortValue,
  expectStringSortValue,
  mySubmissionItem,
  ownerResourceNotFound,
  OWNER_CURSOR_TTL_MS,
} from "@/src/lib/jellyhunt/v2/owner-read-route";
import { parseQuery } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { listMySubmissions } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createOwnerReadHandler(async (request) => {
  const viewer = await requireJellyViewer(request, "jellyhunt:read");
  const query = parseQuery(request, MySubmissionsQuery);
  const queryHash = await computeQueryHash({
    campaignId: query.campaignId ?? null,
    missionId: query.missionId ?? null,
    submissionStatus: query.submissionStatus ?? null,
    rewardStatus: query.rewardStatus ?? null,
    updatedAfter: query.updatedAfter ?? null,
    sort: "updated_at_desc_submission_id_asc",
    limit: query.limit,
  });

  let asOf: number | undefined;
  let beforeUpdatedAt: number | undefined;
  let beforeSubmissionPublicId: string | undefined;
  let openedSnapshot: string | undefined;
  if (query.cursor) {
    const cursor = await openCursor(query.cursor, {
      resource: "me_submissions",
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
    beforeSubmissionPublicId = expectStringSortValue(cursor.lastSortValues[1]);
  }

  const page = await listMySubmissions({
    jellyUserId: viewer.jellyUserId,
    campaignPublicId: query.campaignId,
    missionPublicId: query.missionId,
    submissionStatus: query.submissionStatus,
    rewardStatus: query.rewardStatus,
    updatedAfter: query.updatedAfter,
    limit: query.limit,
    asOf,
    beforeUpdatedAt,
    beforeSubmissionPublicId,
  });
  if (!page) throw ownerResourceNotFound("campaign");
  if (openedSnapshot !== undefined && String(page.asOf) !== openedSnapshot) {
    throw invalidCursor();
  }

  const submissions = (page.items as unknown[]).map(mySubmissionItem);
  let nextCursor: string | null = null;
  if (page.hasMore) {
    if (typeof page.nextUpdatedAt !== "number" || !page.nextSubmissionPublicId) {
      throw new Error("invalid_owner_page");
    }
    const issuedAt = Date.now();
    nextCursor = await sealCursor({
      version: 1,
      resource: "me_submissions",
      subjectHash: await hashCursorSubject(viewer.jellyUserId),
      queryHash,
      limit: query.limit,
      ...(query.campaignId ? { scopeKey: query.campaignId } : {}),
      snapshot: String(page.asOf),
      lastSortValues: [page.nextUpdatedAt, page.nextSubmissionPublicId],
      issuedAt,
      expiresAt: issuedAt + OWNER_CURSOR_TTL_MS,
    });
  }

  return {
    data: { submissions },
    meta: {
      page: { limit: query.limit, nextCursor, hasMore: Boolean(page.hasMore) },
    },
  };
});
