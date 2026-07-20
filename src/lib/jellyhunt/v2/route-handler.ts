import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { JellyhuntV2Error, internalError } from "./errors";
import { wrapSuccess, wrapError } from "./envelope";

type RouteConfig = {
  cachePolicy?: "private" | "public";
  maxAge?: number;
};

export function createV2Handler<T>(
  handler: (request: Request, requestId: string) => Promise<{ data: T; status?: number; headers?: Record<string, string> }>,
  config?: RouteConfig,
) {
  return async (request: Request) => {
    const requestId = randomUUID();
    try {
      const result = await handler(request, requestId);
      const status = result.status ?? 200;
      const envelope = wrapSuccess(result.data, requestId);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...(result.headers ?? {}),
      };

      if (config?.cachePolicy === "private") {
        headers["Cache-Control"] = "private, no-store";
        headers["Vary"] = "Authorization";
      } else if (config?.cachePolicy === "public" && config.maxAge) {
        headers["Cache-Control"] = `public, max-age=${config.maxAge}`;
      }

      return NextResponse.json(envelope, { status, headers });
    } catch (err) {
      if (err instanceof JellyhuntV2Error) {
        return NextResponse.json(wrapError(err.errorCode, err.message, requestId), {
          status: err.statusCode,
          headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
        });
      }
      const internal = internalError();
      return NextResponse.json(wrapError(internal.errorCode, internal.message, requestId), {
        status: 500,
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      });
    }
  };
}
