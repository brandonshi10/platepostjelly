import { z } from "zod";

export const LeaderboardStanding = z
  .object({
    rank: z.number().int().positive(),
    username: z.string().min(1),
    approvedMissionCount: z.number().int().positive(),
  })
  .strict();
export type LeaderboardStanding = z.infer<typeof LeaderboardStanding>;

export const LeaderboardCampaign = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .strict();

export const CurrentSeasonLeaderboardData = z
  .object({
    scope: z.literal("current_season"),
    rankingBasis: z.literal("approved_missions"),
    campaign: LeaderboardCampaign,
    standings: z.array(LeaderboardStanding),
  })
  .strict();

export const AllTimeLeaderboardData = z
  .object({
    scope: z.literal("all_time"),
    rankingBasis: z.literal("approved_missions"),
    startsAt: z.string().datetime(),
    standings: z.array(LeaderboardStanding),
  })
  .strict();

export const LeaderboardData = z.discriminatedUnion("scope", [
  CurrentSeasonLeaderboardData,
  AllTimeLeaderboardData,
]);
export type LeaderboardData = z.infer<typeof LeaderboardData>;

// Backwards-compatible export name for callers that imported the prior data schema.
export const LeaderboardResponse = LeaderboardData;
export type LeaderboardResponse = LeaderboardData;