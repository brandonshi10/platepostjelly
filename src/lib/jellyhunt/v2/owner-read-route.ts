import type { z } from "zod";
import { JellyhuntV2Error, invalidCursor } from "./errors";
import { MyEventItem, MyMissionItem, MySubmissionItem } from "./owner-read-contracts";
import {
  createV2Handler,
  type V2Handler,
  type V2RouteContext,
  type V2RouteResult,
} from "./route-handler";

export function createOwnerReadHandler<
  T,
  P extends Record<string, string> = Record<string, string>,
>(
  handler: (
    request: Request,
    requestId: string,
    context: V2RouteContext<P>,
  ) => Promise<V2RouteResult<T>>,
): V2Handler<P> {
  const route = createV2Handler(handler, { cachePolicy: "private" });
  const ownerRoute = async (request: Request, context?: V2RouteContext<P>) => {
    const response = context ? await route(request, context) : await route(request);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Authorization");
    response.headers.delete("ETag");
    return response;
  };
  return ownerRoute as V2Handler<P>;
}

export function ownerResourceNotFound(
  resource: "campaign" | "participation" | "submission",
): JellyhuntV2Error {
  const messages = {
    campaign: "This campaign does not exist.",
    participation: "This participation does not exist.",
    submission: "This submission does not exist.",
  };
  return new JellyhuntV2Error(404, `${resource}_not_found`, messages[resource]);
}

export function expectNumberSortValue(value: string | number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidCursor();
  return value;
}

export function expectStringSortValue(value: string | number | undefined): string {
  if (typeof value !== "string" || value.length === 0) throw invalidCursor();
  return value;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function optionalId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function myMissionItem(raw: unknown): z.infer<typeof MyMissionItem> {
  const item = objectRecord(raw);
  const missionId = optionalId(objectRecord(item.mission).id);
  const participationId = optionalId(objectRecord(item.participation).id);
  const submissionId = optionalId(objectRecord(item.latestSubmission).id);
  return MyMissionItem.parse({
    ...item,
    links: {
      mission: `/api/v2/jellyhunt/missions/${missionId}`,
      participation: participationId
        ? `/api/v2/jellyhunt/participations/${participationId}`
        : null,
      latestSubmission: submissionId
        ? `/api/v2/jellyhunt/submissions/${submissionId}`
        : null,
    },
  });
}

export function mySubmissionItem(raw: unknown): z.infer<typeof MySubmissionItem> {
  const item = objectRecord(raw);
  const submissionId = optionalId(item.id);
  const missionId = optionalId(objectRecord(item.mission).id);
  return MySubmissionItem.parse({
    ...item,
    links: {
      self: `/api/v2/jellyhunt/submissions/${submissionId}`,
      events: `/api/v2/jellyhunt/submissions/${submissionId}/events`,
      mission: `/api/v2/jellyhunt/missions/${missionId}`,
    },
  });
}

export function myEventItem(raw: unknown): z.infer<typeof MyEventItem> {
  const item = objectRecord(raw);
  const submissionId = optionalId(item.submissionId);
  return MyEventItem.parse({
    ...item,
    links: { submission: `/api/v2/jellyhunt/submissions/${submissionId}` },
  });
}

export const OWNER_CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
