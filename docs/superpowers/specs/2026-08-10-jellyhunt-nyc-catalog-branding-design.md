# JellyHunt NYC Catalog, Dish Missions, and PlatePost Branding — Design

**Date:** 2026-08-10
**Status:** Approved for planning
**Supersedes nothing.** Builds on `2026-07-27-jellyhunt-preview-deployment-design.md`, which stood the deployment up. This spec replaces what is *in* it.

## Goal

Turn JellyHunt from a 16-mission Lower East Side scavenger hunt into the content-sourcing map the program is actually for: 40 verified NYC restaurants, each with three to five missions that name a specific dish to film, wearing PlatePost's brand instead of a generic dark-map look.

Source of truth for the new catalog is `PlatePost_Jelly_Missions_Map_VERIFIED (2).xlsx`, sheet `Restaurant Map`, rows where `City = NYC`.

## Why this changes the program's shape

The 16 missions in the database are scavenger-hunt prompts — "film the cheese pull, caption with one word." One mission per restaurant, one video, no relationship to any menu item.

The spreadsheet describes a different program. A Jelly user films a **named menu item**; PlatePost assembles those clips into a videomenu; the restaurant becomes a warm lead. That only works if a mission points at one dish. So the unit of work moves from *restaurant* to *dish*, and a restaurant becomes a container for several.

## Non-goals

- **No payouts.** `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED` stays `false`. Jelly's token, evidence, and transfer endpoints still do not exist. Approval stays manual.
- **No location proof.** There is still no canonical Jelly place ID, so there is no authoritative way to show a video was shot at the right restaurant. Unchanged by this work, and the reason approval stays manual.
- **No Convex schema change.** Every field this design needs already exists. See "Data model".
- **No production deployment**, no custom domain, no Chicago or LA venues.

## The catalog

**40 venues.**

- **29** from the spreadsheet's NYC rows, missions already written and POS-verified.
- **11** carried over from the current 16: L'imprimerie, Trapizzino, Economy Candy, Russ & Daughters Cafe, Café Integral, The Pastry Box, Librae Bakery, Morgenstern's, Ssäm Bar / Bang Bar, Dimes, Beverly's.
- **Scarr's Pizza** appears in both. The spreadsheet row wins; the existing mission's slug and history are preserved by updating in place rather than creating a second venue.
- **4 dropped** — Conbud (cannabis dispensary), Comedy Cellar (comedy club), Hester Street Fair (open-air market), The Good Company (bar). None fits the dish-mission model: Conbud sells no food at all, and the other three are venues whose draw is the room, the lineup, or the vendors rather than a menu a videomenu could be built from. They are **archived**, not deleted, so their revisions, submissions, and audit history survive.

### Missions per venue: three to five

Not a fixed five. The spreadsheet padded some venues to reach five and the padding is visible — "Counter-Order Shot" (Chelsea Açaí), "Cash-Only Counter Shot" (King Dumplings), "Domino-Game Hangout Shot" (Titi's). Roughly a dozen such fillers are cut. Expected total: **≈170 missions**.

A venue's payout cap is the **sum of its missions**, not a flat 50. A three-mission venue caps at 30 JELLY.

### Launch cohort: 10 published, 30 draft

All 40 load as drafts. Ten are hand-verified and published; the rest are flipped on from `/admin` with no code change. Ten is enough for downtown to look populated and few enough that bad coordinates or a closed restaurant surface cheaply.

The published ten must span neighborhoods rather than clustering, so the map reads as a city.

### Data the spreadsheet does not have

The mission contract (`src/lib/jellyhunt/contracts.ts`) requires fields the sheet omits. Each must be sourced before a venue can be published:

| Field | Required by | Source |
| --- | --- | --- |
| `location.latitude` / `longitude` | `locationSchema` | Geocode the address. **Every published pin verified by eye against a map before publishing.** |
| `hours` | `operatingHoursSchema` — exactly 7 entries, Sunday-first, `HH:MM-HH:MM` or `closed` | Research per venue. No defaulting to a guess. |
| `neighborhood` | `missionSchema` | Derived from address. |
| `price` | `missionSchema` | Sheet's `Approx. Price Point` where present (Budget-Friendly tab), otherwise researched. |
| `emoji` | `missionSchema` | Assigned per mission, cuisine-appropriate. |
| `difficulty` | `missionSchema` | Assigned per mission. Reflects effort to capture, not food. |
| `websiteUrl` | optional | Sheet's `Order/Toast Link`. |

The 11 carried-over venues already have verified coordinates and hours in the database. Those are preserved, not re-derived.

The 11 carried-over venues have **no dish missions**. At three to five each, 33–55 missions are researched against each venue's live menu and proposed as drafts. **Brandon approves them before any is published** — they are the author's research, not verified data.

## Data model

**No Convex schema change.** This is deliberate: a JellyHunt field that is not declared in a validator has taken the restaurant platform down twice, and the risk is not worth a convenience.

**Venue grouping** uses `location.id`, already on every mission (`locationSchema.id`). Missions sharing a place are one venue. Nothing new is stored — venue name, address, coordinates, and time zone all come from the place snapshot the mission already carries.

**Shot type** is carried in two places that already exist:

- `requirements.post.allowedPostTypes`, `prompt`, `minDurationSeconds`, `maxDurationSeconds` on the mission revision — the enforceable side, used by submission preflight.
- A new optional `shotType` on the public `missionSchema` — the display side.

`shotType` is added to `V1_ADDITIVE_KEYS` in `contracts.ts` so `projectLegacyV1` strips it and Jelly's v1 contract stays byte-identical. The map page reads `getMissionResponse()` server-side rather than through the v1 route, so it sees the field regardless. The versioned v1 fixture is updated alongside.

**Reward:** 10 JELLY per mission, token code unchanged (`JELLY-MY-JELLY`, a `z.literal` in the contract). No exchange rate has been published by Jelly; 10 mirrors the spreadsheet's $10 one-for-one so the two never disagree. Changing it later is an admin edit per mission, not a rebuild.

## Shot types

Five types. The type drives the filmer's instructions, the length target, and what a reviewer checks.

| Type | What it is | Length | Instruction | Examples |
| --- | --- | --- | --- | --- |
| `DISH` | One plated item | 8–15s | Hold steady, one close pass over the item | Ube Eclair, Birria Tacos |
| `SPREAD` | Full table or platter | 10–20s | Show the scale, pan across everything | Banchan Spread, Kamayan Feast |
| `ACTION` | Something being made | 10–20s | Start filming before it starts; don't cut early | Live Boba-Cooking Station, Whisking Ritual |
| `DISPLAY` | A case or counter | 8–15s | Slow pass, keep the whole case in frame | Pastry Case Reveal, Gelato Case |
| `RITUAL` | The moment people come for | 8–15s | One take, film the person doing it | Soup Dumpling Slurp, Slice Fold |

Durations become `minDurationSeconds` / `maxDurationSeconds` on the revision, so preflight enforces them rather than merely suggesting them.

## Map and venue view

**One pin per venue**, replacing one pin per mission. Pin count drops from ~170 to 40, and 145 stacked pins at 29 addresses never happens.

Tapping a pin opens the venue: name, address, distance, open/closed, directions — all present today — plus its missions listed beneath, each showing its shot type, reward, and completion state. Each mission is claimable on its own; `START MISSION` moves from the venue to the mission row.

Pin appearance stops encoding difficulty, which is ambiguous once a pin holds several missions. Pins are PlatePost blue; selected pins take the accent; a venue with every mission complete takes a check. Difficulty shows per mission row instead.

Pin emoji is the emoji of the venue's lowest-`sortOrder` mission.

## Branding

PlatePost leads, Jelly is co-billed.

- **Palette:** navy `#071126` ground, PlatePost blue `#4576ef` for pins and primary actions. One bright accent retained for selected pins, reward chips, and completion — without it the map reads as a listings page.
- **Type:** Manrope throughout, replacing Outfit, Quicksand, and Ranchers. Loaded from `~/PlatePost Brand Assets`, self-hosted rather than pulled from Google Fonts.
- **Header:** PlatePost mark first, "PlatePost × Jelly" as the title. The oversized `JELLYHUNT` wordmark shrinks to a line of type — it currently occupies a third of the viewport width and collides with Mapbox street labels.
- **Two calls to action:** "Get Jelly" → the App Store links already in `getJellyAppLinks()`. "PlatePost" → `platepost.io`. Today the page has one button and it converts only for Jelly.

Contrast is checked against the navy ground. The existing muted token `rgba(231,240,255,.65)` is verified or replaced, not assumed.

## Admin

`/admin` already edits missions and flips status without a deploy. Two additions:

- Shot type is editable per mission, from the five-value list.
- The mission list groups by venue, so an operator sees "Supermoon Bakehouse — 5 missions, 2 published" rather than a flat list of 170 rows.

## Testing

- **Catalog import** is a dry run first, printing its target deployment, and is idempotent — re-running creates nothing. This matches the existing `migrate:legacy-jellyhunt` behavior and reuses it.
- **Contract:** the v1 compatibility test proves `shotType` does not reach the legacy projection. It must fail if `shotType` is removed from `V1_ADDITIVE_KEYS` — verified by removing it once and watching the test go red, per the "prove a verifier fails on known-bad input" rule.
- **Grouping:** a unit test that several missions sharing a `location.id` render one pin, and that a venue's cap equals the sum of its active missions rather than a flat 50.
- **Shot type:** preflight rejects a submission outside the type's duration window.
- **Visual:** the map, a venue sheet, and both leaderboard tabs are screenshotted and read by eye at mobile and desktop widths. Green tests are not evidence the map looks right.
- Existing gates all pass: `pnpm test && pnpm test:contracts && pnpm test:convex && pnpm validate:openapi && pnpm lint && pnpm build && pnpm typecheck:convex`.

## Risks

- **Geocoding is the likeliest source of a wrong pin.** 29 addresses, no coordinates given. Every published pin is checked by eye; unpublished ones carry the risk until they are.
- **Hours are researched, not verified data.** A wrong entry shows a venue as open when it is closed. Only affects display — no gate depends on it while approval is manual.
- **The 55 researched missions are the author's judgment.** They stay draft until Brandon approves each.
- **Restaurants close.** Twenty-nine venues were verified when the sheet was written, not today. Each of the published ten is confirmed currently operating.
- **Reward figure is provisional.** If Jelly publishes an exchange rate, 10 is wrong and every mission needs an edit. Cheap now at ~170 drafts, expensive after submissions exist.

## Open question

The spreadsheet also carries verified Chicago and LA venues. This design is NYC-only, as scoped. Whether the map becomes multi-city is a separate decision — the campaign's map bounds are currently a single Manhattan viewport, and more than one city needs a city switcher that does not exist.
