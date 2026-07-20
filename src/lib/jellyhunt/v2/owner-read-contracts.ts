import { z } from "zod";

const publicId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-Za-z]+$`));
const Timestamp = z.preprocess(
  (value) => (typeof value === "number" ? new Date(value).toISOString() : value),
  z.string().datetime({ offset: true }),
);
const NullableTimestamp = z.preprocess(
  (value) => (typeof value === "number" ? new Date(value).toISOString() : value),
  z.string().datetime({ offset: true }).nullable(),
);
const RewardAmount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{0,5}[1-9])?$/);

export const CampaignId = publicId("cam");
export const MissionId = publicId("mis");
export const PlaceId = publicId("plc");
export const ParticipationId = publicId("par");
export const SubmissionId = publicId("sub");
export const RewardId = publicId("rwd");
export const EventId = publicId("evt");

export const SubmissionStatus = z.enum([
  "submitted", "verifying", "needs_review", "approved", "rejected",
]);
export const RewardStatus = z.enum([
  "not_eligible", "queued", "processing", "sent", "failed", "uncertain",
]);
export const DisplayStatus = z.enum([
  "not_started", "in_progress", "submitted", "under_review",
  "approved_reward_pending", "rewarded", "rewarded_removed_from_rankings",
  "rejected", "support_needed",
]);
export const NextAction = z.enum([
  "start_mission", "publish_jelly", "submit_post", "wait_for_verification",
  "wait_for_review", "wait_for_reward", "view_reward", "submit_new_post",
  "contact_support", "none",
]);

const RewardTerms = z.object({
  amount: RewardAmount,
  token: z.string().min(1),
  displayName: z.string().min(1),
});

const MissionRequirements = z.object({
  post: z.object({
    allowedPostTypes: z.array(z.string()).min(1),
    authorshipPolicy: z.string(),
    prompt: z.string(),
    minDurationSeconds: z.number().nonnegative(),
    maxDurationSeconds: z.number().positive(),
    requiredVisibility: z.string(),
  }),
  place: z.object({ attachmentRequired: z.boolean() }),
  location: z.object({ required: z.boolean(), trustedSource: z.string() }),
  schedule: z.object({
    mustBeWithinMissionWindow: z.boolean(),
    mustBeDuringVenueHours: z.boolean(),
  }),
  resubmission: z.object({
    allowedAfterRejection: z.boolean(),
    maxAttempts: z.number().int().positive(),
  }),
});

export const TimelineEntry = z.object({
  sequence: z.number().int().nonnegative(),
  type: z.string().min(1),
  submissionStatus: SubmissionStatus,
  rewardStatus: RewardStatus,
  displayStatus: DisplayStatus,
  reasonCode: z.string().nullable().optional(),
  occurredAt: Timestamp,
});

export const ParticipationDetail = z.object({
  id: ParticipationId,
  status: z.enum(["started", "expired", "replaced"]),
  missionId: MissionId,
  missionRevision: z.number().int().positive(),
  isCurrentMissionRevision: z.boolean(),
  startedAt: Timestamp,
  submissionDeadlineAt: Timestamp,
  resubmissionDeadlineAt: NullableTimestamp,
  attemptsUsed: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  latestSubmissionId: SubmissionId.nullable(),
  terms: z.object({
    title: z.string(),
    description: z.string(),
    instructions: z.array(z.string()),
    missionWindow: z.object({ startsAt: Timestamp, endsAt: Timestamp }),
    reward: RewardTerms,
    requirements: MissionRequirements,
    place: z.object({
      id: PlaceId,
      jellyPlaceId: z.string().min(1),
      name: z.string(),
      address: z.string(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timeZone: z.string().min(1),
    }),
  }),
  currentControls: z.object({
    acceptingSubmissions: z.boolean(),
    reasonCode: z.string().nullable(),
  }),
  canStart: z.boolean(),
  canSubmit: z.boolean(),
  canResubmit: z.boolean(),
  nextAction: NextAction,
  publicMessage: z.string(),
  updatedAt: Timestamp,
});

const SubmissionReward = z.object({
  id: RewardId.nullable(),
  status: RewardStatus,
  amount: RewardAmount,
  token: z.string().min(1),
  transactionId: z.string().nullable(),
  sentAt: NullableTimestamp,
});

export const SubmissionDetail = z.object({
  id: SubmissionId,
  mission: z.object({
    id: MissionId,
    revision: z.number().int().positive(),
    title: z.string(),
  }),
  attempt: z.number().int().positive(),
  jellyPost: z.object({ id: z.string().min(1), watchUrl: z.string().url() }),
  submissionStatus: SubmissionStatus,
  verification: z.object({
    status: z.enum(["pending", "in_progress", "complete", "unavailable"]),
    attempts: z.number().int().nonnegative(),
    reasonCode: z.string().nullable(),
    checkedAt: NullableTimestamp,
  }),
  decision: z.object({
    status: z.enum(["pending", "approved", "rejected"]),
    reasonCode: z.string().nullable(),
    message: z.string().nullable(),
    decidedAt: NullableTimestamp,
  }),
  reward: SubmissionReward,
  displayStatus: DisplayStatus,
  reasonCode: z.string().nullable(),
  publicMessage: z.string(),
  canResubmit: z.boolean(),
  nextAction: NextAction,
  timeline: z.array(TimelineEntry).max(20),
  submittedAt: Timestamp,
  updatedAt: Timestamp,
});

export const MeSummary = z.object({
  subject: z.object({ jellyUserId: z.string().trim().min(1) }),
  campaign: z.object({
    id: CampaignId,
    status: z.enum(["upcoming", "active", "ended"]),
    statusCounts: z.object({
      notStarted: z.number().int().nonnegative(),
      inProgress: z.number().int().nonnegative(),
      submitted: z.number().int().nonnegative(),
      underReview: z.number().int().nonnegative(),
      approvedRewardPending: z.number().int().nonnegative(),
      rewarded: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      supportNeeded: z.number().int().nonnegative(),
    }),
    confirmedRewards: z.object({ amount: RewardAmount, token: z.string().min(1) }),
    latestEventSequence: z.number().int().nonnegative(),
    updatedAt: Timestamp,
  }),
});

export const MyMissionItem = z.object({
  mission: z.object({
    id: MissionId,
    revision: z.number().int().positive(),
    title: z.string(),
    availability: z.object({
      state: z.enum(["upcoming", "available", "paused", "ended", "archived"]),
      acceptingSubmissions: z.boolean(),
      reasonCode: z.string().nullable(),
    }),
    reward: z.object({ amount: RewardAmount, token: z.string().min(1) }),
    display: z.object({
      emoji: z.string(), category: z.string(), difficulty: z.string(), neighborhood: z.string(),
    }),
    place: z.object({
      id: PlaceId, name: z.string(), latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  }),
  participationStatus: z.enum(["not_started", "started"]),
  participation: z.object({
    id: ParticipationId,
    missionRevision: z.number().int().positive(),
    startedAt: Timestamp,
    submissionDeadlineAt: Timestamp,
    resubmissionDeadlineAt: NullableTimestamp,
  }).nullable(),
  latestSubmission: z.object({
    id: SubmissionId,
    attempt: z.number().int().positive(),
    submissionStatus: SubmissionStatus,
    rewardStatus: RewardStatus,
    displayStatus: DisplayStatus,
    updatedAt: Timestamp,
  }).nullable(),
  canStart: z.boolean(),
  canSubmit: z.boolean(),
  canResubmit: z.boolean(),
  nextAction: NextAction,
  reasonCode: z.string().nullable(),
  publicMessage: z.string(),
  updatedAt: Timestamp,
  links: z.object({
    mission: z.string(), participation: z.string().nullable(), latestSubmission: z.string().nullable(),
  }),
});

export const MySubmissionItem = z.object({
  id: SubmissionId,
  source: z.enum(["native", "legacy"]),
  attempt: z.number().int().positive(),
  participationId: ParticipationId.nullable(),
  mission: z.object({ id: MissionId, revision: z.number().int().positive(), title: z.string() }),
  jellyPost: z.object({ id: z.string().min(1), watchUrl: z.string().url() }),
  submissionStatus: SubmissionStatus,
  reward: SubmissionReward,
  displayStatus: DisplayStatus,
  reasonCode: z.string().nullable(),
  publicMessage: z.string(),
  canResubmit: z.boolean(),
  nextAction: NextAction,
  submittedAt: Timestamp,
  updatedAt: Timestamp,
  links: z.object({ self: z.string(), events: z.string(), mission: z.string() }),
});

export const MyEventItem = z.object({
  id: EventId,
  sequence: z.number().int().positive(),
  type: z.string().min(1),
  entity: z.object({
    type: z.string().min(1), id: z.string().min(1), sequence: z.number().int().positive(),
  }),
  changes: z.object({
    participationStatus: z.string().nullable(),
    submissionStatus: SubmissionStatus.nullable(),
    rewardStatus: RewardStatus.nullable(),
    displayStatus: DisplayStatus,
    reasonCode: z.string().nullable(),
    publicMessage: z.string(),
  }),
  occurredAt: Timestamp,
  links: z.object({ submission: z.string() }),
});

const Cursor = z.string().min(1).max(4096);
const Limit20 = z.coerce.number().int().min(1).max(100).default(20);
const Limit50 = z.coerce.number().int().min(1).max(100).default(50);

export const EmptyQuery = z.object({}).strict();
export const MeQuery = z.object({ campaignId: CampaignId.optional() }).strict();
export const MyMissionsQuery = z.object({
  campaignId: CampaignId.optional(),
  participationStatus: z.enum(["not_started", "started"]).optional(),
  cursor: Cursor.optional(),
  limit: Limit20,
}).strict();
export const MySubmissionsQuery = z.object({
  campaignId: CampaignId.optional(),
  missionId: MissionId.optional(),
  submissionStatus: SubmissionStatus.optional(),
  rewardStatus: RewardStatus.optional(),
  updatedAfter: z.string().datetime({ offset: true }).transform((value) => Date.parse(value)).optional(),
  cursor: Cursor.optional(),
  limit: Limit20,
}).strict();
export const MyEventsQuery = z.object({ after: Cursor.optional(), limit: Limit50 }).strict();
export const SubmissionEventsQuery = z.object({ cursor: Cursor.optional(), limit: Limit50 }).strict();

export const ParticipationParams = z.object({ participationId: ParticipationId }).strict();
export const SubmissionParams = z.object({ submissionId: SubmissionId }).strict();
