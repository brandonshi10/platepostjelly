# PlatePost Integration Status

Last updated: 2026-07-17

This document is the single source of truth for whether this repository is
connected to the real, shared PlatePost Convex project. Every value below is
either **evidenced** (backed by a command output, a reviewed PR, or a
credential an operator confirmed exists in the target systems) or marked
**`not_connected`**. Do not change a `not_connected` value to look connected
without attaching the evidence described in its checklist.

## Current standalone repository (this checkout)

| Field | Value |
| --- | --- |
| Repository | `https://github.com/brandonshi10/platepostjelly.git` (`origin`) |
| Branch | `agent/platepost-jellyhunt` |
| HEAD commit at the time this document was written | `098b4f989cfb95769940e884067972382576104a` |
| Nature of this repository | A **standalone, pre-merge** development checkout. It is not PlatePost's real application repository. It exists to build and prove the namespaced `jellyhunt*` Convex schema and functions (Plan 1: "Convex foundation and executable contracts") before that code is reviewed and merged into PlatePost's actual codebase. |
| Convex deployment used for local proof-of-work | An **anonymous, local-only** Convex deployment (`anonymous:anonymous-agent`, `http://127.0.0.1:3210`), created by `CONVEX_AGENT_MODE=anonymous npx convex dev`. No Convex account, team, or project was created or logged into. This deployment only ever existed on the machine that ran it and is never a shared or reachable environment. |

## Canonical PlatePost repository and environments: `not_connected`

None of the following have been established, verified, or granted to this
work. Each is `not_connected` until an operator replaces it with reviewed
evidence per its checklist below.

| Field | Status | What "connected" would look like |
| --- | --- | --- |
| Canonical PlatePost application repository (URL + commit this JellyHunt work would merge into) | `not_connected` | A specific `https://github.com/<platepost-org>/<platepost-repo>` URL and a specific commit SHA on its default/integration branch, recorded here after a PlatePost engineer confirms it in writing (PR description, ticket, or signed message, never a value pasted into chat and trusted blindly). |
| PlatePost Convex team/project (development) | `not_connected` | A named Convex team slug + project slug that a PlatePost engineer has granted this work read/write developer access to, with the grant itself referenced here (e.g. a dashboard screenshot filename, an invite-accepted confirmation, or an internal ticket ID), not just a `CONVEX_DEPLOYMENT` string someone typed into chat. |
| PlatePost Convex development deployment ID | `not_connected` | The `dev:<name>` deployment identifier from `npx convex dashboard` once logged into the real PlatePost project, recorded alongside the date it was confirmed reachable. |
| PlatePost Convex preview deployment ID(s) | `not_connected` | Same evidence bar as development, scoped to Vercel Preview. |
| PlatePost Convex Production deployment ID | `not_connected` | Recorded **only** as an identifier for reference (e.g. for the cutover runbook in Plan 3). This project must never run `convex deploy` or hold a `CONVEX_DEPLOY_KEY` for Production, see [AGENTS.md](../AGENTS.md). |
| PlatePost Vercel team/project | `not_connected` | A named Vercel team + project this repository has actually been imported into, confirmed by a PlatePost operator, per [`docs/NEXT_STEPS.md`](NEXT_STEPS.md) §1. |
| Environment ID mapping (which `CONVEX_DEPLOYMENT` value is used by each Vercel environment: Development / Preview / Production) | `not_connected` | A table, filled in only after the rows above are evidenced, naming exactly which Convex deployment ID backs each Vercel environment. |

**This blocks shared deployment. It does not block local implementation.**
Everything in this repository (schema design, namespaced `jellyhunt*`
Convex functions, contract tests, and now real Convex codegen) has been
built and proven entirely against the anonymous local deployment above.
Local implementation work does not require any row in the table above to be
resolved. What the `not_connected` rows block is specifically: merging this
code into PlatePost's real repository, pushing it to a real PlatePost Convex
project (dev, preview, or Production), and pointing PlatePost's live
Vercel environments at it. See [`docs/NEXT_STEPS.md`](NEXT_STEPS.md) for the
full launch-blocker list gated on these connections.

## Checklist to replace each `not_connected` value with reviewed evidence

Complete in order; do not skip ahead. Every step's evidence must be
independently checkable by someone other than the operator who ran it.

1. **Repository.** A PlatePost engineer identifies the exact canonical
   repository URL and the commit/branch this JellyHunt code should be
   proposed against. Record both here with the date and the name of the
   PlatePost engineer who confirmed it.
2. **Access grant.** A PlatePost admin grants Convex project access (and, if
   applicable, GitHub repository access) to the specific individuals or CI
   identities doing this work, never a credential pasted into a chat
   message or a shared login. Record the grant mechanism (dashboard invite,
   SSO group, etc.), not a copied secret.
3. **Development deployment identification.** With real access in hand, run
   `npx convex login` interactively (never non-interactively, never with a
   deploy key) against the real PlatePost project, then `npx convex dev
   --configure existing` to select the PlatePost **development** deployment
   (never Production). Record the resulting `dev:<name>` deployment ID and
   the date.
4. **Schema merge review.** Before ever pushing this repository's
   `convex/jellyhunt/*` module into the PlatePost project, a PlatePost
   engineer reviews the merge diff against PlatePost's real
   `convex/schema.ts`, confirming every existing PlatePost table literal is
   preserved and no `jellyhunt*` table or index name collides with an
   existing one. Record the PR/review link here.
5. **First real push.** Run `npx convex dev --once --typecheck enable`
   against the confirmed development deployment from step 3. Record the
   command output (or a link to CI logs) showing the push succeeded and
   which deployment it targeted.
6. **Preview and Production environment IDs.** Only after steps 1–5 are
   evidenced, fill in the Preview and Production deployment ID rows above
   for reference. Production must still never receive a `convex deploy` or a
   `CONVEX_DEPLOY_KEY` from this workflow, see the Production cutover gates
   in [`docs/NEXT_STEPS.md`](NEXT_STEPS.md) and the prohibitions in
   [AGENTS.md](../AGENTS.md).
7. **Vercel environment mapping.** A PlatePost operator confirms, per
   Vercel environment (Development/Preview/Production), which
   `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL` pair is configured. Record
   the mapping table here.

Until step 1 is complete, do not attempt steps 2–7. Until this entire
checklist is complete, `docs/NEXT_STEPS.md`'s launch blockers remain
authoritative for what else must happen before Production use.

## What Task 6 actually proved in this standalone repository

- `npx convex dev --once` (via `CONVEX_AGENT_MODE=anonymous`, a **local,
  non-Production, account-free** deployment) successfully pushed this
  repository's full `convex/` directory, including the namespaced
  `convex/jellyhunt/{schema,security,audit,campaigns,places,missions,
  validators,publicIds}.ts` modules and the pre-existing v1 modules, and
  generated real `convex/_generated/{api,server}.{d.ts,js}` and
  `convex/_generated/dataModel.d.ts` bindings (committed in this change).
- Every `jellyhuntCampaigns`, `jellyhuntPlaces`, `jellyhuntMissions`,
  `jellyhuntMissionRevisions`, `jellyhuntSubmissions`,
  `jellyhuntAuditEvents`, and related index from
  `convex/jellyhunt/schema.ts` was created on that local deployment without
  error, confirming the schema is syntactically and structurally valid
  Convex.
- The generated `api`/`internal` objects (`convex/_generated/api.d.ts`)
  correctly enumerate the namespaced `jellyhunt/*` function modules
  alongside the pre-existing v1 modules, proving the namespacing itself
  produces collision-free generated references.
- `CONVEX_DEPLOY_KEY` was never set, requested, or used. No `convex deploy`
  command was run. The only Convex CLI subcommand used against real network
  state was `convex dev --once`, which is the local/development command the
  brief for this task explicitly requires.

## Known gap surfaced by turning on real typecheck (`pnpm typecheck:convex`)

Running `npx convex dev --once --typecheck enable` for the first time in
this repository's history (nothing before this task had a
`convex/_generated/` directory, so this gate had never actually executed)
surfaces 157 pre-existing TypeScript errors, all confined to three
**pre-namespacing v1 function files that this task's file list does not
authorize modifying**: `convex/audit.ts`, `convex/missions.ts`, and
`convex/submissions.ts`. All three still call `ctx.db.query("missions")`,
`ctx.db.insert("locations", ...)`, `ctx.db.query("submissions")`, and
`ctx.db.query("auditEvents")` against the generic, pre-namespacing table
names that `convex/schema.ts` intentionally retired when the namespaced
`jellyhunt*` schema replaced it. `convex/schema.ts`'s own comment already
documents this as deferred work: "the old Convex function files that still
reference those generic table names are migrated onto the namespaced tables
in a later task." `docs/NEXT_STEPS.md` §2 independently lists "Resolve
every Convex generation and TypeScript error" as a still-open,
PlatePost-owned item, and the migration roadmap
(`docs/superpowers/plans/2026-07-16-jellyhunt-convex-migration-roadmap.md`)
scopes rewriting mission/submission/reward workflow logic onto the
namespaced schema to Plan 2 ("Native workflows, rewards, statuses, and
leaderboards"), not this plan's Task 6.

This is **not** an authentication or deployment blocker in the sense that the
local anonymous deployment pushes and bundles these three files
successfully with `--typecheck disable`. But the runtime is broken too, not
just the static types: `convex/schema.ts` intentionally retired the generic
`locations`, `missions`, `submissions`, and `auditEvents` tables these three
files still query and insert against (see the comment in `convex/schema.ts`),
and those tables no longer exist in this repository's schema on any
non-fixture deployment of this branch. Concretely, the live v1 read/write
path (`src/lib/jellyhunt/convex-repository.ts`, via
`anyApi.missions`/`anyApi.submissions`/`anyApi.audit`) would return empty
lists for every query and hit schema-rejected inserts for every mutation
against a real (non-fixture) deployment of this schema. v1 currently works
only in fixture mode (`JELLYHUNT_DATA_SOURCE=fixture`), not against this
branch's real Convex schema. Both the type errors and the runtime breakage
in these three files are resolved by the same Plan 2 rewrite that already
owns them, not by regenerating bindings. Re-run `pnpm typecheck:convex`
(and re-verify the v1 read/write path against a real deployment) after
Plan 2 lands `convex/jellyhunt/submissions.ts` (or an equivalent namespaced
replacement) and retires `convex/audit.ts`, `convex/missions.ts`, and
`convex/submissions.ts`; this gate should go green without further schema
changes.

## Summary

- **Target for this repository right now: local / development only.**
- **Production has never been touched.** No Production deploy key exists in
  this environment, in `.env.local`, or in any committed file.
- Shared/team deployment (PlatePost's real Convex project) remains
  `not_connected` per the table above, by design, until the checklist is
  completed by someone with real PlatePost access.
