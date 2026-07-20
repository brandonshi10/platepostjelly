import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { submissionRequestSchema } from "@/src/lib/jellyhunt/contracts";
import {
  createSubmission,
  JellyhuntDataError,
  JellyhuntSubmissionConflictError,
} from "@/src/lib/jellyhunt/convex-repository";
import { isValidServerKey } from "@/src/lib/jellyhunt/domain";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = randomUUID();

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: {
          code: "legacy_write_disabled",
          message: "Legacy JellyHunt submission writes are disabled. Use the JellyHunt v2 submission API.",
        },
        requestId,
      },
      { status: 410, headers: { "X-Request-Id": requestId } },
    );
  }

  if (
    !isValidServerKey(
      request.headers.get("x-jellyhunt-api-key"),
      process.env.JELLYHUNT_API_KEY,
    )
  ) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Valid Jelly server authentication is required." }, requestId },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    const payload = submissionRequestSchema.parse(await request.json());
    const result = await createSubmission(payload);
    return NextResponse.json(
      { submission: result, requestId },
      { status: 201, headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_submission",
            message: "The submission payload is invalid.",
            details: error.flatten(),
          },
          requestId,
        },
        { status: 400, headers: { "X-Request-Id": requestId } },
      );
    }

    if (error instanceof JellyhuntSubmissionConflictError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message }, requestId },
        { status: 409, headers: { "X-Request-Id": requestId } },
      );
    }
    if (error instanceof JellyhuntDataError) {
      return NextResponse.json(
        { error: { code: error.code, message: "Submission service is temporarily unavailable." }, requestId },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "submission_failed",
          message: "The submission could not be completed.",
        },
        requestId,
      },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}
