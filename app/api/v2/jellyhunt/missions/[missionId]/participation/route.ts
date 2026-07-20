import { z } from "zod";
import { JellyhuntV2Error } from "@/src/lib/jellyhunt/v2/errors";
import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { invalidRequest, isoTimestamp, parseRouteParams } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";
import { startParticipation } from "@/src/lib/jellyhunt/v2/write-repository";

const Params = z.object({ missionId: z.string().regex(/^mis_[0-9A-Za-z]+$/) }).strict();
const Body = z.object({ expectedMissionRevision: z.number().int().nonnegative() }).strict();

async function parseBody(request: Request): Promise<z.infer<typeof Body>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw invalidRequest();
  }
  const parsed = Body.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function contractTimestamp(value: string | number): string {
  return isoTimestamp(value).replace(/\.000Z$/, "Z");
}

function mapParticipationError(error: unknown): never {
  if (error instanceof JellyhuntV2Error) throw error;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("participation_revision_locked")) {
    throw new JellyhuntV2Error(
      409,
      "participation_revision_locked",
      "This participation is locked to a different mission revision.",
    );
  }
  if (message.includes("mission_not_found")) {
    throw new JellyhuntV2Error(404, "mission_not_found", "This mission does not exist.");
  }
  if (message.includes("mission_not_active") || message.includes("mission_not_accepting_submissions")) {
    throw new JellyhuntV2Error(409, "mission_not_available", "This mission is not available.");
  }
  if (
    message.includes("convex_not_configured") ||
    message.includes("convex_service_key_not_configured") ||
    message.includes("unauthorized")
  ) {
    throw new JellyhuntV2Error(
      503,
      "dependency_unavailable",
      "A required dependency is temporarily unavailable.",
    );
  }
  throw error;
}

export const PUT = createV2Handler(
  async (request, requestId, context) => {
    if (new URL(request.url).search) throw invalidRequest();
    const viewer = await requireJellyViewer(request, "jellyhunt:submit");
    const { missionId } = await parseRouteParams(context, Params);
    const body = await parseBody(request);

    let result;
    try {
      result = await startParticipation({
        jellyUserId: viewer.jellyUserId,
        missionPublicId: missionId,
        expectedMissionRevision: body.expectedMissionRevision,
        requestId,
      });
    } catch (error) {
      mapParticipationError(error);
    }

    return {
      status: result.created ? 201 : 200,
      data: {
        id: result.participationPublicId,
        status: "started",
        missionId: result.missionPublicId,
        missionRevision: result.missionRevision,
        jellyPlaceId: result.jellyPlaceId,
        startedAt: contractTimestamp(result.startedAt),
        submissionDeadlineAt: contractTimestamp(result.submissionDeadlineAt),
        resubmissionDeadlineAt: null,
        canStart: false,
        canSubmit: true,
        canResubmit: false,
      },
      links: {
        self: `/api/v2/jellyhunt/participations/${result.participationPublicId}`,
      },
    };
  },
  { cachePolicy: "private" },
);
