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
    const actorId = auth.session.username;

    if (input.action === "approve") {
      await callAdminMutation("approvals", "approveSubmission", {
        submissionPublicId: input.submissionId,
        approvalDecisionId: `admin-review:${input.submissionId}`,
        actorId,
      });
    } else if (input.action === "reject") {
      await callAdminMutation("submissions", "rejectSubmission", {
        submissionPublicId: input.submissionId,
        reason: input.reason,
        actorId,
      });
    } else if (input.action === "retry_verification") {
      await callAdminMutation("submissions", "retryVerification", {
        submissionPublicId: input.submissionId,
        actorId,
      });
    } else if (input.action === "retry_reward") {
      await callAdminMutation("submissions", "retryReward", {
        submissionPublicId: input.submissionId,
        actorId,
      });
    } else {
      await callAdminMutation("submissions", "reconcileUncertainReward", {
        submissionPublicId: input.submissionId,
        outcome: input.action === "reconcile_reward_sent" ? "sent" : "failed",
        transactionId:
          input.action === "reconcile_reward_sent" ? input.transactionId : undefined,
        reason: input.action === "reconcile_reward_failed" ? input.reason : undefined,
        actorId,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminRouteFailure(error);
  }
}
