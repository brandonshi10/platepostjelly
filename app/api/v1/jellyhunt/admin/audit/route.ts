import { NextResponse, type NextRequest } from "next/server";
import {
  adminRouteFailure,
  requireAdminSession,
} from "@/src/lib/jellyhunt/admin-route";
import { callAdminQuery } from "@/src/lib/jellyhunt/convex-repository";

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ events: await callAdminQuery("listAuditEvents") });
  } catch (error) {
    return adminRouteFailure(error);
  }
}
