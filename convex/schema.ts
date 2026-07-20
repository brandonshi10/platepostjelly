import { defineSchema } from "convex/server";
import { jellyhuntTables } from "./jellyhunt/schema";
import { legacyJellyhuntTables } from "./legacySchema";

/**
 * Standalone root schema. The transitional v1 tables remain available while
 * the collision-safe v2 JellyHunt tables are added. In PlatePost's canonical
 * repository, preserve every existing PlatePost table before both spreads.
 */
export default defineSchema({
  ...legacyJellyhuntTables,
  ...jellyhuntTables,
});