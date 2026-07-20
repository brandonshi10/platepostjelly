import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

function getConvexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("convex_not_configured");
  return url;
}

function getServiceKey(): string {
  const key = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
  if (!key) throw new Error("convex_service_key_not_configured");
  return key;
}

function createClient(): ConvexHttpClient {
  return new ConvexHttpClient(getConvexUrl());
}

const campaigns = anyApi.jellyhunt.campaigns;
const missions = anyApi.jellyhunt.missions;
const places = anyApi.jellyhunt.places;
const leaderboards = anyApi.jellyhunt.leaderboards;
const rewards = anyApi.jellyhunt.rewards;
const ownerReads = anyApi.jellyhunt.ownerReads;

export async function getCurrentCampaign() {
  const client = createClient();
  return await client.query(campaigns.getCurrentCampaignDiscovery, {});
}

type ViewerQuery = { jellyUserId?: string; now?: number };

export async function getMission(missionPublicId: string, options: ViewerQuery = {}) {
  const client = createClient();
  return await client.query(missions.getMissionDiscovery, {
    missionPublicId,
    ...(options.jellyUserId
      ? { jellyUserId: options.jellyUserId, serviceKey: getServiceKey() }
      : {}),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

export async function listMissions(options: ViewerQuery & { campaignPublicId?: string } = {}) {
  const client = createClient();
  return await client.query(missions.listMissionDiscovery, {
    ...(options.campaignPublicId ? { campaignPublicId: options.campaignPublicId } : {}),
    ...(options.jellyUserId
      ? { jellyUserId: options.jellyUserId, serviceKey: getServiceKey() }
      : {}),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

export async function getPlace(placePublicId: string) {
  const client = createClient();
  return await client.query(places.getPlaceDiscovery, { placePublicId });
}

export async function getAllTimeLeaderboardContext() {
  const client = createClient();
  return await client.query(leaderboards.getAllTimeLeaderboardContext, {
    serviceKey: getServiceKey(),
  });
}

export async function getCurrentSeasonLeaderboardContext() {
  const client = createClient();
  return await client.query(leaderboards.getCurrentSeasonLeaderboardContext, {
    serviceKey: getServiceKey(),
  });
}

export async function listLeaderboard(args: {
  scopeKey: string;
  limit: number;
  expectedRevision: number;
  resume?: {
    eligibleItemsSeen: number;
    lastRank: number;
    lastScore: number;
    lastUsername: string;
    lastPublicId: string;
  };
}) {
  const client = createClient();
  return await client.query(leaderboards.listLeaderboard, {
    serviceKey: getServiceKey(),
    ...args,
  });
}

export async function getRewardIntentStatus(intentPublicId: string) {
  const client = createClient();
  return await client.query(rewards.getRewardIntentStatus, {
    serviceKey: getServiceKey(),
    intentPublicId,
  });
}

export async function getParticipation(
  jellyUserId: string,
  participationPublicId: string,
  now = Date.now(),
) {
  const client = createClient();
  return await client.query(ownerReads.getOwnerParticipation, {
    serviceKey: getServiceKey(), jellyUserId, participationPublicId, now,
  });
}

export async function getSubmission(
  jellyUserId: string,
  submissionPublicId: string,
  now = Date.now(),
) {
  const client = createClient();
  return await client.query(ownerReads.getOwnerSubmission, {
    serviceKey: getServiceKey(), jellyUserId, submissionPublicId, now,
  });
}

export async function listSubmissionEvents(args: {
  jellyUserId: string;
  submissionPublicId: string;
  limit: number;
  asOfSequence?: number;
  beforeSequence?: number;
}) {
  const client = createClient();
  return await client.query(ownerReads.listOwnerSubmissionEvents, {
    serviceKey: getServiceKey(), ...args,
  });
}

export async function getMe(args: {
  jellyUserId: string;
  campaignPublicId?: string;
  now: number;
}) {
  const client = createClient();
  return await client.query(ownerReads.getOwnerSummary, {
    serviceKey: getServiceKey(), ...args,
  });
}

export async function listMyMissions(args: {
  jellyUserId: string;
  campaignPublicId?: string;
  participationStatus?: "not_started" | "started";
  limit: number;
  now: number;
  asOf?: number;
  beforeUpdatedAt?: number;
  beforeMissionPublicId?: string;
}) {
  const client = createClient();
  return await client.query(ownerReads.listOwnerMissions, {
    serviceKey: getServiceKey(), ...args,
  });
}

export async function listMySubmissions(args: {
  jellyUserId: string;
  campaignPublicId?: string;
  missionPublicId?: string;
  submissionStatus?: "submitted" | "verifying" | "needs_review" | "approved" | "rejected";
  rewardStatus?: "not_eligible" | "queued" | "processing" | "sent" | "failed" | "uncertain";
  updatedAfter?: number;
  limit: number;
  asOf?: number;
  beforeUpdatedAt?: number;
  beforeSubmissionPublicId?: string;
}) {
  const client = createClient();
  return await client.query(ownerReads.listOwnerSubmissions, {
    serviceKey: getServiceKey(), ...args,
  });
}

export async function listMyEvents(args: {
  jellyUserId: string;
  afterSequence?: number;
  limit: number;
}) {
  const client = createClient();
  return await client.query(ownerReads.listOwnerEvents, {
    serviceKey: getServiceKey(), ...args,
  });
}
