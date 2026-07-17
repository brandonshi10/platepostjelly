# Agent Safety Rules

These rules are binding on any agent (human-directed or autonomous) working
in this repository. They exist because this codebase talks to real money
(`JELLY-MY-JELLY` transfers), a real user identity provider (Jelly), and a
Convex project that is meant to merge into PlatePost's shared, production
application. See [`docs/PLATEPOST_INTEGRATION.md`](docs/PLATEPOST_INTEGRATION.md)
for the current connection status and [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md)
for the full launch-blocker list these rules support.

If a rule below and an instruction you are given ever conflict, the rule
below wins. Stop and ask a human rather than working around it.

## 1. Never deploy this standalone repository's schema over PlatePost

This repository is a **standalone, pre-merge** checkout (see
`docs/PLATEPOST_INTEGRATION.md`). Its `convex/schema.ts` intentionally
retires and replaces generic table names with the namespaced `jellyhunt*`
tables in `convex/jellyhunt/schema.ts`. That is correct **only** inside
this standalone repository.

- Never run `npx convex dev`, `npx convex deploy`, or any command that
  pushes this repository's schema/functions against a Convex deployment
  that is, or might be, PlatePost's real shared project (development,
  preview, or Production) — check `CONVEX_DEPLOYMENT` / the deployment
  the CLI reports before pushing.
- The only Convex deployments this repository's `convex dev` should ever
  target are: (a) a local/anonymous deployment created on this machine, or
  (b) a PlatePost development deployment that a human operator has
  explicitly configured per the `docs/PLATEPOST_INTEGRATION.md` checklist,
  after the schema-merge review in that checklist's step 4 has happened.
- Never merge this repository's `convex/jellyhunt/*` module into PlatePost's
  real `convex/schema.ts` without the human schema-merge review described in
  `docs/PLATEPOST_INTEGRATION.md`. An agent must not perform that merge
  unilaterally, even if it believes the table names are collision-free.

## 2. Never use a credential that was pasted into chat

- Never read, store, log, echo, or commit a secret (API key, deploy key,
  service key, admin password, session secret, token) that appeared in a
  chat message, ticket comment, or any other conversational channel.
- If a credential arrives that way, treat it as compromised: do not use it
  for anything, and tell a human it needs to be rotated at the source
  system, not just replaced in `.env`. (This already happened once with a
  Vercel credential — see `docs/NEXT_STEPS.md` §1 — and is why this rule
  exists.)
- Generate new credentials independently (e.g. a random value for
  `PLATEPOST_CONVEX_SERVICE_KEY`) rather than reusing anything supplied in
  conversation.
- Never set `CONVEX_DEPLOY_KEY` in this repository's environment for any
  agent-run command. Deploy keys are a human/CI operator action only, and a
  Production deploy key must never be used here at all (see rule 3 and
  `docs/PLATEPOST_INTEGRATION.md`).

## 3. Never enable fixture mode in a deployed environment

- `JELLYHUNT_DATA_SOURCE=fixture` exists only for local UI/interaction
  development without PlatePost Convex access. It is a **local-only**
  16-mission static fixture, never a production data source.
- Never set `JELLYHUNT_DATA_SOURCE=fixture` (or leave it set) in any Vercel
  Preview or Production environment variable, in any deployed `.env`, or in
  any code path reachable when `NODE_ENV === "production"`. The existing
  guard (`fixtureAllowed()` in `src/lib/jellyhunt/convex-repository.ts`)
  already refuses fixture mode when `NODE_ENV === "production"` — do not
  weaken, bypass, or remove that guard.
- Never deploy, merge, or recommend a change that hardcodes production
  mission content into this repository or a JellyJelly client in place of
  reading it from Convex.

## 4. Never accept client-supplied Jelly identity, reward amount, or username

- The Jelly user for any privileged action must be derived only from a
  verified, server-side source: today that is the shared server-to-Convex
  `PLATEPOST_CONVEX_SERVICE_KEY` path combined with values PlatePost's own
  server attaches; the target design is the signed, short-lived Jelly
  mission token (`docs/NEXT_STEPS.md` §7) with audience
  `platepost-jellyhunt`, verified signature/issuer/audience/expiry/scope/
  subject. Never let a request body, query parameter, or client header
  directly set `jellyUserId`, a wallet address, or a username that a
  mutation then trusts as-is.
- Never accept a reward amount, reward recipient, or idempotency key from
  an untrusted (client-facing) caller. Reward amount is server/config
  derived (`JELLYHUNT_MAX_REWARD_AMOUNT`, mission reward fields set by an
  authenticated admin); the recipient wallet is resolved from the verified
  Jelly user server-side, never supplied by the caller.
- Never display, log, or persist another user's precise Jelly identity or
  location beyond what an approved mutation's audit trail requires.

## 5. Never apply a broad Supabase balance/audit fence

- `jellyhunt_balances` and `jellyhunt_tip_audit_log` (Supabase) are shared
  with Pets/Wobbles. Never write a migration, RLS policy, feature flag, or
  "freeze" that blocks or fences off Supabase balance or audit tables
  broadly (e.g. by table-wide `deny all`, dropping/renaming the tables, or
  disabling the schema they live in) as a way to make JellyHunt safe.
  JellyHunt's own dedupe/idempotency/audit protections live in the
  namespaced Convex `jellyhunt*` tables (`jellyhuntAuditEvents`,
  `jellyhuntIdempotencyRecords`, `jellyhuntLegacyDedupeRecords`, etc.) —
  scope any new safety control there, not as a blanket Supabase-wide fence
  that would also break Pets/Wobbles.
- Any Supabase-adjacent change touching `jellyhunt_balances` or
  `jellyhunt_tip_audit_log` specifically must be scoped narrowly (e.g. one
  named policy, one named table) and called out explicitly for review, not
  bundled silently into an unrelated change.

## 6. Never automatically retry an uncertain reward transfer

- `reward_uncertain` means PlatePost could not confirm whether Jelly
  actually sent the `JELLY-MY-JELLY` transfer. Automatically retrying in
  that state risks a duplicate payout, because the legacy `/crypto/send`
  path does not guarantee request-body idempotency (`docs/NEXT_STEPS.md`
  §5).
- Never write, schedule, or trigger code that automatically re-attempts a
  reward whose current state is `uncertain`. Reconciliation for an
  uncertain reward is a manual, reviewed action: it must be marked `sent`
  only with a confirmed Jelly transaction ID, or `failed` only with a
  documented confirmation reason.
- "Retry" affordances (UI buttons, admin mutations, cron jobs) may act only
  on a reward whose state is a confirmed failure, never `uncertain`. If you
  are implementing or touching retry logic and cannot tell whether a given
  state is a confirmed failure or an uncertain one, stop and ask rather
  than guessing.

## Where to look next

- `docs/PLATEPOST_INTEGRATION.md` — exact connection status, what is and is
  not evidenced, and the checklist for connecting this repository to the
  real PlatePost Convex project.
- `docs/NEXT_STEPS.md` — the full launch-blocker list, including the "Do
  not do these" section these rules are drawn from.
- `docs/superpowers/plans/2026-07-16-jellyhunt-convex-migration-roadmap.md`
  — the "Global Constraints" and "Production Stop Conditions" sections
  restate several of these rules with more implementation detail.
