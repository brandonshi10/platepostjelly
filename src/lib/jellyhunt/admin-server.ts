import "server-only";

import type { NextRequest } from "next/server";
import { isValidServerKey } from "./domain";
import {
  ADMIN_SESSION_COOKIE,
  type AdminSession,
  verifyAdminSession,
} from "./admin-auth";

export function adminEnvironmentConfigured() {
  return Boolean(
    process.env.JELLYHUNT_ADMIN_USERNAME &&
      process.env.JELLYHUNT_ADMIN_PASSWORD &&
      process.env.JELLYHUNT_ADMIN_SESSION_SECRET,
  );
}

export function adminCredentialsAreValid(username: string, password: string) {
  return (
    isValidServerKey(username, process.env.JELLYHUNT_ADMIN_USERNAME) &&
    isValidServerKey(password, process.env.JELLYHUNT_ADMIN_PASSWORD)
  );
}

export function readAdminSession(token: string | null | undefined): AdminSession | null {
  return verifyAdminSession(token, process.env.JELLYHUNT_ADMIN_SESSION_SECRET);
}

export function readAdminRequestSession(request: NextRequest) {
  return readAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}

export function requestHasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
