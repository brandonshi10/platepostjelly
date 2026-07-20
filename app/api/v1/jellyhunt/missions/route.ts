import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  getMissionResponse,
  JellyhuntDataError,
} from "@/src/lib/jellyhunt/convex-repository";
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
    const data = await getMissionResponse(userId);
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
