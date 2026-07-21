# PlatePost Integration Status

Last updated: 2026-07-20

This document is the source of truth for the GitHub handoff and for whether
this repository is connected to PlatePost's shared Convex and Vercel
environments. A status may be marked complete only with independently
reviewable evidence such as a merged PR, dashboard-confirmed project ID, or
CI/deployment log. A value written in chat is not connection evidence and
must never be treated as a usable credential.

## Current delivery decision

The code handoff is complete in GitHub. The current owner decision is
**GitHub-only; deployment paused**.

- Git work may continue in `brandonshi10/platepostjelly`.
- Do not create, link, or deploy a Vercel project until a PlatePost owner
  explicitly lifts the hold.
- Do not push this repository's full Convex schema to PlatePost's shared
  project until the schema-merge review below is complete.
- PlatePost's shared Convex environments and Production have not been
  changed by this delivery.

## Evidenced repository handoff

| Field | Evidenced value |
| --- | --- |
| Canonical JellyHunt delivery repository | [`brandonshi10/platepostjelly`](https://github.com/brandonshi10/platepostjelly) |
| Default branch | `main` |
| Full implementation | [PR #3](https://github.com/brandonshi10/platepostjelly/pull/3), merged as `99149fa696972471dbc06c1748ade56ac87ecceb` |
| Dependency-error follow-up | [PR #4](https://github.com/brandonshi10/platepostjelly/pull/4), merged as `179bd444286fd740acb5f52829a2ef843e9ce43f` |
| Current delivery mode | GitHub source handoff only; Vercel deployment intentionally paused |
| Shared PlatePost Convex changes | None |
| Production changes | None |
| Local Convex proof | Anonymous, local-only deployment used for schema/codegen proof; no shared account project or Production deploy key was used |

## External integration status

| Integration | Status | Evidence required to change it |
| --- | --- | --- |
| JellyHunt source repository | `connected` | Already evidenced by the merged PRs above |
| Decision to embed in PlatePost's main application repository | `pending_optional` | PlatePost records whether this dedicated app is deployed directly or deliberately merged into another repository |
| PlatePost Convex team/project | `not_connected` | Named team/project plus accepted developer access |
| PlatePost Convex development deployment | `not_connected` | Confirmed `dev:<name>` identifier and successful reviewed development push |
| PlatePost Convex Preview deployment | `not_connected` | Confirmed Preview identifier and environment mapping |
| PlatePost Convex Production deployment | `not_connected` | Identifier recorded for the approved cutover runbook only |
| Existing PlatePost Vercel team/project | `deployment_paused` | Exact existing team/project recorded after the owner lifts the hold; do not create a duplicate |
| Vercel-to-Convex environment mapping | `not_connected` | Development, Preview, and Production mapping reviewed by PlatePost |
| Jelly mission-token and partner APIs | `not_connected` | Accepted JWKS/token, place-feed, preflight, evidence, profile, reward, and capacity contracts |
| Jelly native application | `not_connected` | Development app proves the v2 mission journey and owner-status handling |

These external gaps block a shared Preview or Production deployment. They do
not block continued GitHub review, local fixture development, or contract
work.

## Verified implementation baseline

The following evidence was completed before the GitHub handoff:

- `pnpm test`: 36 files and 249 tests passed.
- `pnpm test:convex`: 21 files and 185 tests passed.
- Application TypeScript, Convex TypeScript/code generation, lint, OpenAPI
  validation, and the production build passed.
- The local `/human-social` experience rendered all 16 fixture missions on
  desktop and mobile, including search/filtering, mission details, themes,
  directions, app handoff, and both leaderboard views.
- `/admin` rendered and failed closed when admin configuration was absent.
- v1 mission discovery returned the fixture catalog; authenticated v2 owner
  routes failed closed without valid auth.
- Public v2 discovery and leaderboard routes return retryable
  `503 dependency_unavailable` responses while the required shared Convex
  functions are absent, rather than a misleading generic internal error.

The obsolete earlier finding that Convex typechecking produced 157 errors and
that non-fixture v1 was structurally broken no longer applies. The namespaced
workflow implementation and compatibility repository calls landed in the
merged implementation, and the final local typecheck/test gates passed.

## Checklist when PlatePost resumes deployment

Complete these steps in order and attach evidence for each:

1. **Lift the hold.** A named PlatePost owner explicitly authorizes a Preview
   deployment and records whether this repository is deployed directly or
   embedded into the main PlatePost application.
2. **Rotate exposed credentials.** Revoke the chat-exposed Convex and Vercel
   values. Use named access and fresh development-only secrets; never reuse
   a value copied from chat.
3. **Identify existing Vercel infrastructure.** Record the exact PlatePost
   team and existing project. Link that project; do not create a competing
   or duplicate project.
4. **Grant Convex developer access.** Use a team invite or approved identity,
   never a Production deploy key in this repository or an agent command.
5. **Review the complete Convex integration boundary.** Diff the root
   `convex/schema.ts`, `convex/jellyhunt/*`, `convex/legacySchema.ts`, old
   root function modules, HTTP routes, and crons against PlatePost. Preserve
   every existing PlatePost table, index, function, route, cron, and webhook,
   including the Manus webhook. Decide explicitly whether the transitional
   generic legacy tables/functions are excluded or deliberately retained;
   prove v1 compatibility remains on the namespaced workflow path and record
   the decision in the reviewed integration PR.
6. **Push development only.** Run Convex generation/typecheck against the
   confirmed development deployment and record the deployment ID and logs.
7. **Map environments.** Record the Development, Preview, and Production
   Convex URLs/deployment IDs used by each Vercel environment. Keep rewards
   disabled and fixture mode absent in deployed environments.
8. **Import reviewed drafts.** Dry-run the 16-mission migration, confirm its
   target, import drafts/manual-review records, and review every place,
   schedule, proof rule, geofence, reward, and budget before publishing.
9. **Connect Jelly.** Complete and accept the mission-token/JWKS, canonical
   place/post evidence, usernames, reward-intent/lookup, and capacity APIs.
10. **Deploy one Preview.** Prove an admin edit reaches `/human-social`, v1,
    and v2 without a code release, then run the full native and failure-mode
    acceptance checklist.
11. **Keep Production gated.** Do not promote until migration, security,
    accessibility, budgets, payout reconciliation, monitoring, rollback, and
    named operator approvals are complete.

See [Next Steps](NEXT_STEPS.md) for the complete acceptance checklist and
[AGENTS.md](../AGENTS.md) for binding safety rules.

## Summary

- The source implementation is complete and merged into GitHub `main`.
- Deployment is intentionally paused at the GitHub handoff boundary.
- No Vercel project is linked from this checkout.
- PlatePost's shared Convex and Production environments remain untouched.
- The next infrastructure action, only after the hold is lifted, is to
  identify the exact existing Vercel project and safely merge/connect the
  namespaced JellyHunt backend to PlatePost development Convex.
