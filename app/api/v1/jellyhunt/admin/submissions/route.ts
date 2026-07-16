import { NextResponse, type NextRequest } from "next/server";
import { adminSubmissionActionSchema } from "@/src/lib/jellyhunt/admin-contracts";
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
    const status = request.nextUrl.searchParams.get("status") ?? "all";
    return NextResponse.json({
      submissions: await callAdminQuery("listAdminSubmissions", { status }),
    });
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
    const input = adminSubmissionActionSchema.parse(await request.json());
    const actor = auth.session.username;
    if (input.action === "retry_verification") {
      await callAdminMutation("submissions", "retryVerification", {
        submissionId: input.submissionId,
        actor,
      });
    } else if (input.action === "retry_reward") {
      await callAdminMutation("submissions", "retryReward", {
        submissionId: input.submissionId,
        actor,
      });
    } else if (
      input.action === "reconcile_reward_sent" ||
      input.action === "reconcile_reward_failed"
    ) {
      await callAdminMutation("submissions", "reconcileUncertainReward", {
        submissionId: input.submissionId,
        outcome: input.action === "reconcile_reward_sent" ? "sent" : "failed",
        transactionId:
          input.action === "reconcile_reward_sent" ? input.transactionId : undefined,
        reason: input.action === "reconcile_reward_failed" ? input.reason : undefined,
        actor,
      });
    } else {
      await callAdminMutation("submissions", "adminReviewSubmission", {
        submissionId: input.submissionId,
        action: input.action,
        reason: input.action === "reject" ? input.reason : undefined,
        actor,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminRouteFailure(error);
  }
}
