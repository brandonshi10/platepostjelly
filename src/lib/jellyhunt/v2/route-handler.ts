import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { semanticEtag } from "./cache";
import { dependencyUnavailable, JellyhuntV2Error, internalError } from "./errors";
import { wrapError, wrapSuccess, type V2MetaExtras } from "./envelope";

export type V2RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

export type V2Handler<P extends Record<string, string>> = {
  (request: Request): Promise<Response>;
  (request: Request, context: V2RouteContext<P>): Promise<Response>;
};

type RouteConfig = {
  cachePolicy?: "private" | "public";
  maxAge?: number;
  staleWhileRevalidate?: number;
  etag?: boolean;
};

export type V2RouteResult<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
  meta?: V2MetaExtras;
  links?: Record<string, unknown>;
  cachePolicy?: "private" | "public";
  maxAge?: number;
  staleWhileRevalidate?: number;
  etag?: boolean;
};

function matchesIfNoneMatch(request: Request, etag: string): boolean {
  const value = request.headers.get("if-none-match");
  if (!value) return false;
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === etag);
}

const DEPENDENCY_ERROR_MARKERS = [
  "convex_not_configured",
  "convex_service_key_not_configured",
  "could not find public function",
  "could not find function",
  "no address for function",
  "failed to fetch",
  "fetch failed",
  "network error",
  "connection error",
  "econnrefused",
  "enotfound",
  "etimedout",
] as const;

function isDependencyUnavailableError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === "string") {
      const normalized = current.toLowerCase();
      return DEPENDENCY_ERROR_MARKERS.some((marker) => normalized.includes(marker));
    }
    if (typeof current !== "object") return false;

    const candidate = current as { cause?: unknown; message?: unknown; name?: unknown };
    const normalized = [candidate.name, candidate.message]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (DEPENDENCY_ERROR_MARKERS.some((marker) => normalized.includes(marker))) return true;
    current = candidate.cause;
  }
  return false;
}

function errorResponse(error: JellyhuntV2Error, requestId: string): NextResponse {
  return NextResponse.json(
    wrapError(error.errorCode, error.message, requestId, {
      retryable: error.statusCode >= 500 || error.statusCode === 429,
      restartRequired: error.errorCode === "invalid_cursor",
    }),
    {
      status: error.statusCode,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
    },
  );
}

export function createV2Handler<
  T,
  P extends Record<string, string> = Record<string, string>,
>(
  handler: (
    request: Request,
    requestId: string,
    context: V2RouteContext<P>,
  ) => Promise<V2RouteResult<T>>,
  config: RouteConfig = {},
) {
  const route = async (request: Request, context?: V2RouteContext<P>) => {
    const requestId = randomUUID();
    const routeContext = context ?? { params: Promise.resolve({} as P) };
    try {
      const result = await handler(request, requestId, routeContext);
      const status = result.status ?? 200;
      const envelope = wrapSuccess(result.data, requestId, {
        meta: result.meta,
        links: result.links,
      });
      const headers = new Headers({
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...(result.headers ?? {}),
      });

      const cachePolicy = result.cachePolicy ?? config.cachePolicy;
      if (cachePolicy === "private") {
        headers.set("Cache-Control", "private, no-store");
        headers.set("Vary", "Authorization");
      } else if (cachePolicy === "public") {
        const maxAge = Math.max(0, Math.trunc(result.maxAge ?? config.maxAge ?? 30));
        const staleWhileRevalidate = Math.max(
          0,
          Math.trunc(result.staleWhileRevalidate ?? config.staleWhileRevalidate ?? 120),
        );
        headers.set(
          "Cache-Control",
          `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
        );

        if (result.etag ?? config.etag ?? true) {
          const etag = await semanticEtag(envelope);
          headers.set("ETag", etag);
          if (matchesIfNoneMatch(request, etag)) {
            headers.delete("Content-Type");
            return new Response(null, { status: 304, headers });
          }
        }
      }

      return NextResponse.json(envelope, { status, headers });
    } catch (error) {
      if (error instanceof JellyhuntV2Error) {
        return errorResponse(error, requestId);
      }
      return errorResponse(
        isDependencyUnavailableError(error) ? dependencyUnavailable() : internalError(),
        requestId,
      );
    }
  };
  return route as V2Handler<P>;
}
