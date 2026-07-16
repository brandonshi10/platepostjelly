import {
  missionSchema,
  type JellyhuntMission,
  type SubmissionStatus,
  type UserMissionStatus,
} from "./contracts";

export type SubmissionEvent =
  | { type: "verification_started" }
  | { type: "verification_passed"; approvalMode: "manual" | "automatic" }
  | { type: "verification_failed" }
  | { type: "admin_approved" }
  | { type: "admin_rejected" }
  | { type: "reward_queued" }
  | { type: "reward_sent" }
  | { type: "reward_failed" }
  | { type: "reward_uncertain" };

const transitions: Record<SubmissionStatus, Partial<Record<SubmissionEvent["type"], SubmissionStatus>>> = {
  submitted: {
    verification_started: "verifying",
    verification_passed: "needs_review",
    verification_failed: "rejected",
  },
  verifying: {
    verification_passed: "needs_review",
    verification_failed: "rejected",
  },
  needs_review: {
    admin_approved: "approved",
    admin_rejected: "rejected",
  },
  approved: {
    reward_queued: "reward_queued",
  },
  rejected: {},
  reward_queued: {
    reward_sent: "reward_sent",
    reward_failed: "reward_failed",
    reward_uncertain: "reward_uncertain",
  },
  reward_sent: {},
  reward_failed: {
    reward_queued: "reward_queued",
  },
  reward_uncertain: {},
};

export function submissionConflictCode(message: string) {
  if (/jelly post already used/i.test(message)) return "jelly_post_reused" as const;
  if (/mission already submitted/i.test(message)) return "mission_already_submitted" as const;
  return null;
}
export function createDedupeKey(args: {
  missionId: string;
  jellyUserId: string;
  jellyPostId: string;
}) {
  return [args.missionId, args.jellyUserId, args.jellyPostId]
    .map((part) => part.trim().toLowerCase())
    .join(":");
}

export function nextSubmissionStatus(
  current: SubmissionStatus,
  event: SubmissionEvent,
): SubmissionStatus {
  const next = transitions[current][event.type];

  if (!next) {
    throw new Error(`Cannot apply ${event.type} to ${current}`);
  }

  if (event.type === "verification_passed" && event.approvalMode === "automatic") {
    return "approved";
  }

  return next;
}

export function isMissionVisible(mission: JellyhuntMission, now = new Date()) {
  if (mission.status !== "active") return false;
  if (mission.startsAt && new Date(mission.startsAt) > now) return false;
  if (mission.endsAt && new Date(mission.endsAt) < now) return false;
  return true;
}

type Coordinates = { latitude: number; longitude: number };

export function haversineDistanceMeters(from: Coordinates, to: Coordinates) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekdayIndex = weekdays.indexOf(value("weekday") ?? "");
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));

  return {
    weekdayIndex,
    minutes: hour * 60 + minute,
  };
}

function parseHours(entry: string) {
  if (!entry || entry === "closed") return null;
  const [opensAt, closesAt] = entry.split("-");
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  return { opensAt: toMinutes(opensAt), closesAt: toMinutes(closesAt) };
}

export function getMissionOpenState(
  hours: string[],
  at = new Date(),
  timeZone = "America/New_York",
): "open" | "closed" | "unknown" {
  if (hours.length !== 7) return "unknown";

  const { weekdayIndex, minutes } = zonedParts(at, timeZone);
  if (weekdayIndex < 0 || Number.isNaN(minutes)) return "unknown";

  const today = parseHours(hours[weekdayIndex]);
  if (today) {
    const closesAt = today.closesAt <= today.opensAt ? today.closesAt + 24 * 60 : today.closesAt;
    if (minutes >= today.opensAt && minutes < closesAt) return "open";
  }

  const previousDayIndex = (weekdayIndex + 6) % 7;
  const previousDay = parseHours(hours[previousDayIndex]);
  if (previousDay && previousDay.closesAt <= previousDay.opensAt && minutes < previousDay.closesAt) {
    return "open";
  }

  return "closed";
}

export function filterMissions(
  missions: JellyhuntMission[],
  filters: { query?: string; category?: string; status?: string },
  statuses: UserMissionStatus[] = [],
) {
  const statusByMission = new Map(statuses.map((status) => [status.missionId, status.status]));
  const query = filters.query?.trim().toLocaleLowerCase();

  return missions.filter((mission) => {
    if (filters.category && filters.category !== "all" && mission.category !== filters.category) {
      return false;
    }

    const missionStatus = statusByMission.get(mission.id) ?? "not_started";
    if (filters.status && filters.status !== "all" && missionStatus !== filters.status) {
      return false;
    }

    if (!query) return true;

    return [
      mission.title,
      mission.description,
      mission.category,
      mission.neighborhood,
      mission.location.name,
      mission.location.address ?? "",
      mission.restaurantTag,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}



export function isValidServerKey(
  provided: string | null | undefined,
  expected: string | null | undefined,
) {
  if (!provided || !expected || provided.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

type RawConvexLocation = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  address?: unknown;
  jellyRestaurantId?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  geofenceRadiusMeters?: unknown;
  timeZone?: unknown;
};

type RawConvexMission = Record<string, unknown> & {
  _id?: unknown;
  id?: unknown;
  location?: RawConvexLocation | null;
};

export function mapConvexMission(value: RawConvexMission): JellyhuntMission {
  const missionId = String(value._id ?? value.id ?? "");
  if (!value.location) {
    throw new Error(`Mission ${missionId || "unknown"} has no location`);
  }

  const location = value.location;
  const toIso = (timestamp: unknown) =>
    typeof timestamp === "number" ? new Date(timestamp).toISOString() : undefined;

  return missionSchema.parse({
    id: missionId,
    slug: value.slug,
    title: value.title,
    description: value.description,
    status: value.status,
    approvalMode: value.approvalMode,
    rewardAmount: value.rewardAmount,
    rewardToken: value.rewardToken ?? "JELLY-MY-JELLY",
    startsAt: toIso(value.startsAt),
    endsAt: toIso(value.endsAt),
    restaurantTag: value.restaurantTag,
    category: value.category,
    difficulty: value.difficulty,
    emoji: value.emoji,
    neighborhood: value.neighborhood,
    price: value.price,
    hours: value.hours,
    venueType: value.venueType,
    showtimes: value.showtimes,
    sortOrder: value.sortOrder,
    websiteUrl: value.websiteUrl,
    location: {
      id: String(location._id ?? location.id ?? ""),
      jellyRestaurantId: location.jellyRestaurantId,
      name: location.name,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      geofenceRadiusMeters: location.geofenceRadiusMeters,
      timeZone: location.timeZone ?? "America/New_York",
    },
  });
}
