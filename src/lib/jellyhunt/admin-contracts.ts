import { z } from "zod";
import {
  approvalModeSchema,
  missionDifficultySchema,
  missionStatusSchema,
  operatingHoursSchema,
} from "./contracts";

const optionalTrimmedString = z.string().trim().transform((value) => value || undefined).optional();
const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timeZoneSchema = z.string().trim().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Use a valid IANA time zone, such as America/New_York");

export const adminLocationInputSchema = z.object({
  name: z.string().trim().min(1),
  address: optionalTrimmedString,
  jellyRestaurantId: optionalTrimmedString,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofenceRadiusMeters: z.number().int().positive(),
  timeZone: timeZoneSchema,
});

export const adminMissionInputSchema = z.object({
  slug: z.string().trim().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: missionStatusSchema,
  approvalMode: approvalModeSchema,
  restaurantTag: z.string().trim().min(1),
  rewardAmount: z.number().positive(),
  category: z.string().trim().min(1),
  difficulty: missionDifficultySchema,
  emoji: z.string().trim().min(1),
  neighborhood: z.string().trim(),
  price: z.string().trim(),
  hours: operatingHoursSchema,
  venueType: optionalTrimmedString,
  showtimes: z.array(clockTimeSchema).optional(),
  sortOrder: z.number().int().nonnegative(),
  websiteUrl: z.string().url().optional(),
  startsAt: z.number().int().positive().optional(),
  endsAt: z.number().int().positive().optional(),
}).refine(
  (mission) => !mission.startsAt || !mission.endsAt || mission.startsAt < mission.endsAt,
  { message: "Mission start must be before mission end", path: ["endsAt"] },
);

const adminBudgetAmountSchema = z.string().trim()
  .regex(/^(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?$/)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    const canonicalFraction = fraction.replace(/0+$/, "");
    return canonicalFraction ? `${whole}.${canonicalFraction}` : whole;
  });

export const adminBudgetInputSchema = z.object({
  campaignAllocatedAmount: adminBudgetAmountSchema,
  missionAllocatedAmount: adminBudgetAmountSchema,
  expectedCampaignRevision: z.number().int().nonnegative(),
  expectedMissionRevision: z.number().int().nonnegative(),
});

export const createAdminMissionSchema = z.object({
  mission: adminMissionInputSchema,
  location: adminLocationInputSchema,
  budgets: adminBudgetInputSchema.optional(),
});

export const updateAdminMissionSchema = createAdminMissionSchema.extend({
  missionId: z.string().min(1),
  locationId: z.string().min(1),
});

export const updateAdminMissionStatusSchema = z.object({
  missionId: z.string().min(1),
  status: missionStatusSchema,
});

export const adminSubmissionActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    submissionId: z.string().min(1),
  }),
  z.object({
    action: z.literal("reject"),
    submissionId: z.string().min(1),
    reason: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("retry_verification"),
    submissionId: z.string().min(1),
  }),
  z.object({
    action: z.literal("retry_reward"),
    submissionId: z.string().min(1),
  }),
  z.object({
    action: z.literal("reconcile_reward_sent"),
    submissionId: z.string().min(1),
    transactionId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("reconcile_reward_failed"),
    submissionId: z.string().min(1),
    reason: z.string().trim().min(1),
  }),
]);
