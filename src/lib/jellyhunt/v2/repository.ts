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
