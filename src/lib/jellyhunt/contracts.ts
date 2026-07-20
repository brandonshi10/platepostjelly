import { z } from "zod";

export const approvalModeSchema = z.enum(["manual", "automatic"]);
export const missionStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
export const missionDifficultySchema = z.enum(["easy", "medium", "hard", "legendary"]);
export const submissionStatusSchema = z.enum([
  "submitted",
  "verifying",
  "needs_review",
  "approved",
  "rejected",
  "reward_queued",
  "reward_sent",
  "reward_failed",
  "reward_uncertain",
]);

const clockTime = "(?:[01]\\d|2[0-3]):[0-5]\\d";
export const operatingHoursSchema = z
  .array(z.union([z.literal("closed"), z.string().regex(new RegExp(`^${clockTime}-${clockTime}$`))]))
  .length(7);

export const locationSchema = z.object({
  id: z.string().min(1),
  jellyRestaurantId: z.string().min(1).optional(),
  name: z.string().min(1),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofenceRadiusMeters: z.number().int().positive(),
  timeZone: z.string().min(1).default("America/New_York"),
});

export const missionSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  status: missionStatusSchema,
  approvalMode: approvalModeSchema,
  rewardAmount: z.number().positive(),
  rewardToken: z.literal("JELLY-MY-JELLY"),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  restaurantTag: z.string().min(1),
  category: z.string().min(1),
  difficulty: missionDifficultySchema,
  emoji: z.string().min(1),
  neighborhood: z.string().default(""),
  price: z.string().default(""),
  hours: operatingHoursSchema,
  venueType: z.string().optional(),
  showtimes: z.array(z.string().regex(new RegExp(`^${clockTime}$`))).optional(),
  sortOrder: z.number().int().nonnegative(),
  websiteUrl: z.string().url().optional(),
  location: locationSchema,
});

export const userMissionStatusSchema = z.object({
  missionId: z.string(),
  status: submissionStatusSchema.or(z.literal("not_started")),
  submissionId: z.string().optional(),
  jellyPostId: z.string().optional(),
  rejectionReason: z.string().optional(),
  rewardTransactionId: z.string().optional(),
});

export const missionsResponseSchema = z.object({
  apiVersion: z.literal("1.0"),
  generatedAt: z.string().datetime(),
  missions: z.array(missionSchema),
  userStatus: z.array(userMissionStatusSchema).optional(),
});

export const submissionRequestSchema = z.object({
  missionId: z.string().min(1),
  jellyUserId: z.string().min(1),
  jellyPostId: z.string().min(1),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).refine(
  (value) => (value.latitude === undefined) === (value.longitude === undefined),
  { message: "latitude and longitude must be supplied together" },
);

export type ApprovalMode = z.infer<typeof approvalModeSchema>;
export type MissionStatus = z.infer<typeof missionStatusSchema>;
export type MissionDifficulty = z.infer<typeof missionDifficultySchema>;
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;
export type JellyhuntMission = z.infer<typeof missionSchema>;
export type UserMissionStatus = z.infer<typeof userMissionStatusSchema>;
export type MissionsResponse = z.infer<typeof missionsResponseSchema>;
export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;

const V1_ADDITIVE_KEYS = new Set(["publicId", "revision", "requestId"]);

export function projectLegacyV1(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectLegacyV1);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !V1_ADDITIVE_KEYS.has(key))
      .map(([key, child]) => [key, projectLegacyV1(child)]),
  );
}
