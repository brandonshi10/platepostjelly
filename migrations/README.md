# Legacy Jellyhunt mission import

`legacy-jellyhunt-missions.json` transcribes the 16 mission records that were
hardcoded in the legacy Jellyhunt page. The legacy venue name, mission copy,
address text, coordinates, category, reward, difficulty, emoji, neighborhood,
price, hours, showtimes, tier, and accent are retained for review.

Target-only fields are deliberately conservative:

- Every mission imports as `draft` with `approvalMode: manual`.
- `restaurantTag` and `slug` are provisional normalized values derived from the
  venue name.
- The 75-meter geofence is a provisional operational default.
- `America/New_York` is assigned because every legacy coordinate is in New York.
- No canonical Jelly restaurant ID is guessed.

PlatePost and Jelly operations must verify the venue is still operating, address,
coordinates, hours, restaurant tag or location ID, geofence, mission copy, and
reward before changing a mission to `active`.

## Run the importer

Set `CONVEX_URL` and `PLATEPOST_CONVEX_SERVICE_KEY` in the shell for the intended
non-production Convex deployment. Preview the exact plan first:

```bash
pnpm migrate:legacy-jellyhunt
```

No data changes in the default mode. After checking the displayed deployment and
every planned slug, explicitly apply it:

```bash
pnpm migrate:legacy-jellyhunt --apply
```

The importer reads existing missions through `listAdminMissions`, skips and logs
every existing slug without updating it, and creates each missing mission plus
location atomically through `createMissionWithLocation`. A rerun therefore does
not duplicate a mission. It cannot publish a mission or initiate a reward.
