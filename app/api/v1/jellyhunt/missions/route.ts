import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  getMissionResponse,
  JellyhuntDataError,
} from "@/src/lib/jellyhunt/convex-repository";
import { projectLegacyV1 } from "@/src/lib/jellyhunt/contracts";
import { isValidServerKey } from "@/src/lib/jellyhunt/domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id")?.trim() || undefined;

  if (
    userId &&
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
    // projectLegacyV1 existed but nothing called it, so every additive field
    // reached Jelly's frozen v1 payload — shotType was landing on each mission
    // object, which is the part their native decoder parses. Strip additive
    // keys here, then add requestId to the envelope, which v1 already carried.
    const data = projectLegacyV1(await getMissionResponse(userId)) as Record<string, unknown>;
    return NextResponse.json(
      { ...data, requestId },
      {
        headers: {
          "Cache-Control": userId ? "private, no-store" : "public, s-maxage=30, stale-while-revalidate=120",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (error) {
    const code =
      error instanceof JellyhuntDataError ? error.code : "data_source_unavailable";
    return NextResponse.json(
      {
        error: {
          code,
          message: "Mission data is temporarily unavailable.",
        },
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
}
