import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { JellyhuntDataError } from "./convex-repository";
import {
  readAdminRequestSession,
  requestHasTrustedOrigin,
} from "./admin-server";

export function requireAdminSession(request: NextRequest) {
  const session = readAdminRequestSession(request);
  if (!session) {
    return {
      response: NextResponse.json(
        { error: { code: "admin_unauthorized", message: "Admin sign-in is required." } },
        { status: 401 },
      ),
    } as const;
  }
  return { session } as const;
}

export function rejectUntrustedMutation(request: NextRequest) {
  if (requestHasTrustedOrigin(request)) return null;
  return NextResponse.json(
    { error: { code: "untrusted_origin", message: "This request origin is not allowed." } },
    { status: 403 },
  );
}

export function adminRouteFailure(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_admin_request",
          message: "Check the highlighted mission fields and try again.",
          fields: error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof JellyhuntDataError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 503 },
    );
  }

  const message = error instanceof Error ? error.message : "Admin request failed.";
  const conflict = /already|duplicate|reused|not ready|cannot be|uncertain/i.test(message);
  return NextResponse.json(
    { error: { code: conflict ? "admin_conflict" : "admin_request_failed", message } },
    { status: conflict ? 409 : 500 },
  );
}
