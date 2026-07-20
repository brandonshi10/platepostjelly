# JellyHunt Convex Migration Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the provisional JellyHunt persistence and Supabase-era workflow with PlatePost-owned, namespaced Convex state while preserving the original public map, adding native v2 APIs and rankings, and fencing legacy payout paths safely.

**Architecture:** Work is split into three implementation plans with explicit dependency gates. The first freezes contracts and builds the shared Convex foundation; the second implements authenticated mission workflows, rewards, statuses, and leaderboards; the third connects PlatePost web/admin and performs reviewed migration, cutover, deployment, and documentation.

**Tech Stack:** Node.js 18+, pnpm 9.15.4, Next.js 15.5.20 App Router, React 19, TypeScript 5.7, Convex 1.27.1, Zod 3.24, Mapbox GL 3.26, Vitest 2.1, Testing Library, Playwright, OpenAPI 3.1.

## Global Constraints

- Never use, store, log, or commit a credential pasted into chat.
- Local work and CI previews use a local, development, or preview Convex deployment; a `prod:` deploy key is never used by a developer command.
- All physical JellyHunt Convex tables and feature modules use the `jellyhunt` namespace.
- The PlatePost root schema, HTTP router, cron registry, Manus webhook, admin shell, and unrelated functions remain present after integration.
- PlatePost/Convex owns campaigns, places, missions, revisions, participations, submissions, idempotency, dedupe, reviews, reward orchestration, audit, events, and rankings.
- Jelly owns identity, canonical username, posts, canonical place association, trusted evidence, balances, and the final transfer.
- Personalized v2 routes derive the Jelly user only from a five-minute asymmetric token with audience `platepost-jellyhunt`.
- Reward amounts cross HTTP boundaries as canonical decimal strings; payout state never determines leaderboard score.
- Current-season rank counts non-reversed approved mission completions in the concrete current campaign. All-time starts at the immutable PlatePost launch epoch and excludes legacy history.
- Production automatic rewards remain disabled until Jelly’s intent/lookup contract, reconciliation, cutover receipt, and zero-quarantine gates pass.
- `jellyhunt_balances` and `jellyhunt_tip_audit_log` remain available to Pets/Wobbles; no broad Supabase freeze is permitted.

---

## Ordered Plan Suite

1. [Convex foundation and executable contracts](2026-07-16-jellyhunt-convex-foundation.md)
2. [Native workflows, rewards, statuses, and leaderboards](2026-07-16-jellyhunt-native-workflows.md)
3. [PlatePost map/admin, migration, cutover, and deployment](2026-07-16-jellyhunt-web-admin-cutover.md)

Plan 2 starts only after Plan 1’s contract fixtures and namespaced schema are green. Plan 3 UI work may start after Plan 1, but migration, cutover, and deployment tasks wait for all Plan 2 safety tests.

## Baseline Evidence

- `pnpm test`: 16 files and 64 tests pass.
- `pnpm lint`: exits zero with `--max-warnings=0`.
- `pnpm build`: Next.js production build exits zero and renders `/human-social`, `/admin`, and existing v1 routes.
- Convex generated bindings are absent because no development deployment is configured; `pnpm exec convex dev --once --typecheck enable` is therefore a Plan 1 gate.
- The only local environment setting is fixture mode. No Convex deploy credential is stored locally.

## Production Stop Conditions

Execution must stop before Production whenever any of these is true:

- `docs/PLATEPOST_INTEGRATION.md` lacks exact source/target commits, Vercel project/team, Convex development/preview/Production mapping, domains, checksums, or named approvers.
- The standalone schema has not been reviewed as a merge into PlatePost’s real schema/router/crons.
- Jelly mission-token, place/content/evidence, public-profile, reward-intent/lookup, or webhook fixtures are unsigned or failing.
- Mission provenance or legacy-history checksums are unreviewed.
- A payout-capable quarantine row or orphan successful transaction remains.
- The Supabase fence has not been rehearsed against authenticated and service-role callers while Pets/Wobbles regression tests pass.
- Automatic rewards are not explicitly disabled before the first Production code/data promotion.

