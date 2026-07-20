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
  if (
    !isValidServerKey(
      request.headers.get("x-jellyhunt-api-key"),
      process.env.JELLYHUNT_API_KEY,
    )
  ) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Valid Jelly server authentication is required." } },
      { status: 401 },
    );
  }

  try {
    const payload = submissionRequestSchema.parse(await request.json());
    const result = await createSubmission(payload);
    return NextResponse.json({ submission: result }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_submission",
            message: "The submission payload is invalid.",
            details: error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    if (error instanceof JellyhuntSubmissionConflictError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 409 },
      );
    }
    if (error instanceof JellyhuntDataError) {
      return NextResponse.json(
        { error: { code: error.code, message: "Submission service is temporarily unavailable." } },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "submission_failed",
          message: "The submission could not be completed.",
        },
      },
      { status: 500 },
    );
  }
}
