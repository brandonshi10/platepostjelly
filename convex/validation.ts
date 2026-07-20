const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const hoursEntry = /^(?:closed|(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d)$/;

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
}

export function validateLocationInput(input: {
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  timeZone: string;
}) {
  requiredText(input.name, "Location name");
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    throw new Error("Invalid latitude");
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw new Error("Invalid longitude");
  }
  if (
    !Number.isInteger(input.geofenceRadiusMeters) ||
    input.geofenceRadiusMeters <= 0 ||
    input.geofenceRadiusMeters > 50_000
  ) {
    throw new Error("Geofence radius must be a positive whole number no greater than 50000 meters");
  }
  requiredText(input.timeZone, "Location time zone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format();
  } catch {
    throw new Error("Location time zone must be a valid IANA time zone");
  }
}

export function validateMissionInput(
  input: {
    slug: string;
    title: string;
    description: string;
    restaurantTag: string;
    category: string;
    emoji: string;
    approvalMode: "manual" | "automatic";
    rewardAmount: number;
    sortOrder: number;
    hours: string[];
    showtimes?: string[];
    websiteUrl?: string;
    startsAt?: number;
    endsAt?: number;
  },
  options: {
    maxRewardAmount: number;
    partnerVerificationConfigured: boolean;
  },
) {
  requiredText(input.slug, "Mission slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new Error("Mission slug must use lowercase letters, numbers, and single hyphens");
  }
  requiredText(input.title, "Mission title");
  requiredText(input.description, "Mission description");
  requiredText(input.restaurantTag, "Restaurant tag");
  requiredText(input.category, "Mission category");
  requiredText(input.emoji, "Mission emoji");

  if (!Number.isFinite(input.rewardAmount) || input.rewardAmount <= 0) {
    throw new Error("Reward amount must be positive");
  }
  if (
    !Number.isFinite(options.maxRewardAmount) ||
    options.maxRewardAmount <= 0 ||
    input.rewardAmount > options.maxRewardAmount
  ) {
    throw new Error(`Reward amount exceeds the configured maximum of ${options.maxRewardAmount}`);
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    throw new Error("Mission sort order must be a non-negative whole number");
  }
  if (input.hours.length !== 7 || input.hours.some((entry) => !hoursEntry.test(entry))) {
    throw new Error("Mission hours must contain seven closed or HH:MM-HH:MM entries");
  }
  if (input.showtimes?.some((entry) => !clockTime.test(entry))) {
    throw new Error("Mission showtimes must use HH:MM");
  }
  if (input.websiteUrl) {
    try {
      const url = new URL(input.websiteUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      throw new Error("Mission website must be a valid HTTP(S) URL");
    }
  }
  if (
    input.startsAt !== undefined &&
    (!Number.isFinite(input.startsAt) || input.startsAt < 0)
  ) {
    throw new Error("Mission start time is invalid");
  }
  if (
    input.endsAt !== undefined &&
    (!Number.isFinite(input.endsAt) || input.endsAt < 0)
  ) {
    throw new Error("Mission end time is invalid");
  }
  if (
    input.startsAt !== undefined &&
    input.endsAt !== undefined &&
    input.startsAt >= input.endsAt
  ) {
    throw new Error("Mission start must be before mission end");
  }
  if (input.approvalMode === "automatic" && !options.partnerVerificationConfigured) {
    throw new Error("Automatic missions require Jelly partner verification");
  }
}

export function missionValidationOptions() {
  const configuredMaximum = Number(process.env.JELLYHUNT_MAX_REWARD_AMOUNT ?? "10000");
  return {
    maxRewardAmount:
      Number.isFinite(configuredMaximum) && configuredMaximum > 0
        ? configuredMaximum
        : 10_000,
    partnerVerificationConfigured: Boolean(
      process.env.JELLY_PARTNER_VERIFY_URL && process.env.JELLY_PARTNER_API_KEY,
    ),
  };
}
