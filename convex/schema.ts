import { defineSchema } from "convex/server";
import { jellyhuntTables } from "./jellyhunt/schema";

/**
 * Root Convex schema.
 *
 * JellyHunt tables live in `convex/jellyhunt/schema.ts` under a collision-safe
 * `jellyhunt*` namespace so this module merges cleanly into PlatePost's real,
 * shared Convex schema later: every existing PlatePost table literal is
 * preserved before this spread, and this spread never overwrites one.
 *
 * This standalone repository has no other tables yet, so the merged schema
 * is currently just the JellyHunt inventory. The generic pre-namespacing
 * tables (`locations`, `missions`, `submissions`, `rewardAttempts`,
 * `auditEvents`) that used to live here are intentionally retired by this
 * spread in favor of their namespaced `jellyhunt*` equivalents; the old
 * Convex function files that still reference those generic table names are
 * migrated onto the namespaced tables in a later task.
 */
export default defineSchema({
  ...jellyhuntTables,
});
