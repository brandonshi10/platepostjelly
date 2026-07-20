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
const leaderboards = anyApi.jellyhunt.leaderboards;
const rewards = anyApi.jellyhunt.rewards;

export async function getCurrentCampaign() {
  const client = createClient();
  return await client.query(campaigns.getCurrentCampaign, {});
}

export async function getMission(missionPublicId: string) {
  const client = createClient();
  return await client.query(missions.getMissionByPublicId, { missionPublicId });
}

export async function listLeaderboard(scopeKey: string, limit?: number) {
  const client = createClient();
  return await client.query(leaderboards.listLeaderboard, { scopeKey, limit });
}

export async function getRewardIntentStatus(intentPublicId: string) {
  const client = createClient();
  return await client.query(rewards.getRewardIntentStatus, {
    serviceKey: getServiceKey(),
    intentPublicId,
  });
}
