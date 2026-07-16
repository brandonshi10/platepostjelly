# PlatePost Jellyhunt End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure PlatePost-hosted Jellyhunt vertical slice in which an admin edit in Convex appears on the public map and native API, a Jelly user can submit once, an admin can review it, and Jelly executes one auditable reward.

**Architecture:** Next.js hosts the public map and authenticated API boundary. Convex owns mission/location/submission/dedupe/reward state, while internal actions call Jelly for proof and tipping. Browser code never receives PlatePost service credentials or Jelly payout credentials.

**Tech Stack:** Next.js App Router, React, TypeScript, Convex, Zod, Mapbox GL, Vitest, Testing Library.

## Global Constraints

- Missions must not be hardcoded in the JellyJelly website, native app, or PlatePost production runtime.
- PlatePost/Convex is the Jellyhunt operational database.
- Jelly API remains the source for users, posts, restaurant proof, trusted location proof, and tipping.
- All writes and user-specific reads fail closed when authentication is missing.
- Verification and reward actions derive mission, user, post, and amount from Convex records.
- Admin pages never expose production secrets in browser-visible code.
- Legacy `/crypto/send` transport ambiguity is never automatically retried.

---

### Task 1: Contract and Map Domain

**Files:** `src/lib/jellyhunt/contracts.ts`, `src/lib/jellyhunt/map.ts`, `tests/jellyhunt-contracts.test.ts`, `tests/jellyhunt-map.test.ts`

- [ ] Write failing tests for extended mission fields, distance, open-hours, category/status filtering, and coordinate bounds.
- [ ] Run `pnpm test -- tests/jellyhunt-contracts.test.ts tests/jellyhunt-map.test.ts` and confirm failures describe missing behavior.
- [ ] Implement the minimal schemas and pure map helpers.
- [ ] Re-run the focused tests and then `pnpm test`.

### Task 2: Secure Convex Repository and API Boundary

**Files:** `src/lib/jellyhunt/convex-repository.ts`, `src/lib/jellyhunt/request-auth.ts`, `app/api/v1/jellyhunt/missions/route.ts`, `app/api/v1/jellyhunt/submissions/route.ts`, `app/api/v1/jellyhunt/progress/route.ts`

- [ ] Write failing tests for fail-closed authentication, Convex-to-contract mapping, validation, and stable error responses.
- [ ] Add server-only Convex function references and service-key forwarding.
- [ ] Replace sample-backed runtime imports with the Convex repository.
- [ ] Require Jelly server authentication for user-specific reads and all submission writes.
- [ ] Run focused tests and the full suite.

### Task 3: Convex Security and Workflow

**Files:** `convex/schema.ts`, `convex/security.ts`, `convex/missions.ts`, `convex/submissions.ts`, `convex/jelly.ts`, `convex/audit.ts`

- [ ] Extend mission/location/submission/reward fields and indexes.
- [ ] Gate every non-public function with `PLATEPOST_CONVEX_SERVICE_KEY`.
- [ ] Add mission/location create and full update mutations.
- [ ] Enforce one active user/mission submission and global Jelly-post reuse prevention.
- [ ] Schedule internal verification, manual/automatic approval, database-derived reward execution, and audit events.
- [ ] Run `pnpm convex dev` and Convex typecheck after PlatePost authentication is available.

### Task 4: Consumer Map

**Files:** `app/human-social/page.tsx`, `app/human-social/jellyhunt-explorer.tsx`, `app/map/page.tsx`, `app/globals.css`

- [ ] Add the Mapbox mission layer and coordinate-accurate no-token fallback.
- [ ] Add mission selection, drawer, search, filters, distance, hours, geolocation, status, and responsive keyboard behavior.
- [ ] Add JellyJelly camera deep link and iOS/Android fallback links.
- [ ] Verify loading, empty, configuration, and error states.

### Task 5: Admin

**Files:** `src/lib/jellyhunt/admin-auth.ts`, `app/api/v1/jellyhunt/admin/**/route.ts`, `app/admin/page.tsx`, `app/admin/admin-dashboard.tsx`, `tests/jellyhunt-admin-auth.test.ts`

- [ ] Test and add signed HTTP-only admin sessions.
- [ ] Wire mission/location create, edit, publish, pause, and archive forms.
- [ ] Wire submission filters, approve/reject, reward status/retry, and audit history.
- [ ] Ensure all browser operations pass through authenticated server routes.

### Task 6: Documentation and Handoff

**Files:** `README.md`, `CHANGELOG.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/NEXT_STEPS.md`

- [ ] Document setup, environment ownership, local fixture rules, Convex seed/deploy, Vercel deploy, and rollback.
- [ ] Document native/admin endpoints with example payloads and error codes.
- [ ] Document the PlatePost/Jelly boundary and missing partner verification/reward contracts.
- [ ] Record all changes and keep a prioritized next-steps checklist for PlatePost and Jelly engineers.

### Task 7: Verification

- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run Convex codegen/typecheck when PlatePost credentials are available.
- [ ] Verify desktop and mobile public-map flows in a browser.
- [ ] Verify admin edit-to-map and submission-to-reward flows against a development Convex deployment.
