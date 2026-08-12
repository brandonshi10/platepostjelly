# What PlatePost needs from Jelly to launch JellyHunt

**Status:** everything on PlatePost's side is built and deployed. Nothing below can be built by us — each item is a decision or an endpoint that only Jelly can provide. Until they exist, the programme can show missions but cannot verify a submission or pay anyone.

**Live today:** https://jellyhunt.vercel.app/human-social — 37 New York restaurants, 175 dish missions, 10 published. Rewards are switched off at three separate flags.

---

## 1. Consent to use the video — blocking, and the one with legal exposure

The whole programme takes a clip filmed by a Jelly user and puts it into a restaurant's commercial menu. **Nobody has agreed to that in writing.**

PlatePost's map now states plainly what filming a mission permits, but that page is not where the user acts — they tap through into the Jelly app and submit there. Disclosure on our side is not consent on yours.

**What we need:** an explicit, recorded agreement at the point of submission in the Jelly app, covering

- a licence to PlatePost to use, trim, crop and publish the clip in a restaurant's menu, in perpetuity, and to sublicense it to that restaurant;
- confirmation the filmer shot it themselves;
- confirmation no identifiable person appears without their agreement;
- a way to withdraw, and what happens to menus already carrying the clip.

**What we need back per submission:** the consent version accepted and the timestamp. Without it PlatePost cannot prove a right to publish any of this footage.

Neither side's lawyer has reviewed the wording currently on the map. It is disclosure, written to be honest and readable, not a contract.

## 2. Mission tokens — blocking

Every v2 write route rejects unauthenticated callers with a 401 today, and correctly so: `JELLY_MISSION_JWKS_URL` is unset, so no bearer token can be verified and no caller-supplied identity is trusted.

**What we need:**

- a **JWKS URL** we can fetch public keys from;
- the **issuer** string and the **audience** we should expect;
- the claim carrying the Jelly user id, and the token lifetime.

Verification is already written (`convex/jellyhunt/` mission-token verifier). It is waiting on those four values.

## 3. Proof a video was shot at the restaurant — blocking

This is the largest gap and the reason every mission is on manual approval.

**There is no canonical Jelly place ID.** `jellyRestaurantId` is absent from every record we hold, so a place identity is derived from our own slug. Nothing connects a Jelly post to a restaurant, which means nothing can prove a submitted clip was filmed at the venue that is about to be paid for.

**What we need, in order of preference:**

1. a **place id on the Jelly post** that we can map to our venues, plus the place list to map against;
2. failing that, **capture coordinates and capture time** on the post, so we can check them against the venue's geofence and opening hours;
3. failing both, an honest statement that this cannot be verified — in which case manual review is permanent and the programme should be sized accordingly.

## 4. Clip format — blocking for usable footage, not for launch

A clip only becomes a videomenu if PlatePost's pipeline can play it. Accepted: **H.264/VP8/VP9/AV1, 8-bit `yuv420p`, vertical**. Rejected: **HEVC**, 10-bit, landscape.

This matters more than it sounds. **The iPhone camera's default setting records HEVC**, and that exact combination has already rendered a live dish as a black tile on a PlatePost menu. Filmers are told to switch to Most Compatible, but a setting nobody enforces is a setting most people miss.

**What we need:** the post's **codec, pixel format, width and height** returned with the submission. PlatePost already has the checker (`clipIsUsable`); it just has nothing to check. Better still, have the Jelly app record H.264 for mission captures regardless of the phone's setting.

## 5. Paying people — blocking for rewards

Automatic dispatch is off and stays off until this exists.

**What we need:**

- a **transfer endpoint**, idempotent on a key we supply, so a retry cannot pay twice;
- the **status/lookup endpoint** for an attempt whose result we never saw;
- what a **wobble** is worth, and the decimals it settles in.

The reward worker, watchdog, reservation ledger and at-most-once accounting are built and tested against a stub.

**Open on PlatePost's side:** missions currently pay **10 wobbles** each, mapped one-for-one from the $10 per video in the source spreadsheet. If that is wrong, it is one value to change while every mission is still a draft, and a migration afterwards.

## 6. Who reviews, and how fast

Approval is manual and will stay manual until item 3 is solved. A filmer who has shot a dish is owed an answer in a predictable time.

**What we need:** who reviews, the target turnaround, and what a filmer sees while waiting.

---

## What is already done and needs nothing from Jelly

- 37 venues and 175 dish missions, each naming a specific dish and a shot type that sets the filming instruction and an enforced clip length.
- Map, venue view, operator dashboard, mission lifecycle, immutable revisions, audit trail, budget reservations with at-most-once accounting.
- v1 compatibility frozen for the native app; v2 routes implemented and documented in OpenAPI.
- Rewards disabled at three flags; every v2 write returns 401 without a Jelly token.

## Contact

brandon@platepost.io
