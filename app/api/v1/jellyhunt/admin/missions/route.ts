import { NextResponse, type NextRequest } from "next/server";
import {
  createAdminMissionSchema,
  updateAdminMissionSchema,
  updateAdminMissionStatusSchema,
} from "@/src/lib/jellyhunt/admin-contracts";
import {
  adminRouteFailure,
  rejectUntrustedMutation,
  requireAdminSession,
} from "@/src/lib/jellyhunt/admin-route";
import {
  callAdminMutation,
  callAdminQuery,
} from "@/src/lib/jellyhunt/convex-repository";

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if ("response" in auth) return auth.response;
  try {
    const [missions, budgetContext] = await Promise.all([
      callAdminQuery("listAdminMissions"),
      callAdminQuery("getAdminBudgetContext"),
    ]);
    return NextResponse.json({ missions, budgetContext });
  } catch (error) {
    return adminRouteFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if ("response" in auth) return auth.response;
  const originError = rejectUntrustedMutation(request);
  if (originError) return originError;

  try {
    const input = createAdminMissionSchema.parse(await request.json());
    const result = await callAdminMutation("missions", "createMissionWithLocation", {
      mission: input.mission,
      location: input.location,
      budgets: input.budgets,
      actorId: auth.session.username,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return adminRouteFailure(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireAdminSession(request);
  if ("response" in auth) return auth.response;
  const originError = rejectUntrustedMutation(request);
  if (originError) return originError;

  try {
    const input = updateAdminMissionSchema.parse(await request.json());
    await callAdminMutation("missions", "updateMissionWithLocation", {
      mission: input.mission,
      location: input.location,
      budgets: input.budgets,
      missionId: input.missionId,
      locationId: input.locationId,
      actorId: auth.session.username,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminRouteFailure(error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireAdminSession(request);
  if ("response" in auth) return auth.response;
  const originError = rejectUntrustedMutation(request);
  if (originError) return originError;

  try {
    const input = updateAdminMissionStatusSchema.parse(await request.json());
    await callAdminMutation("missions", "updateMissionStatus", {
      ...input,
      actorId: auth.session.username,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminRouteFailure(error);
  }
}
