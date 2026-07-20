import "server-only";

import { z } from "zod";
import { JellyhuntV2Error } from "./errors";
import {
  dependencyInvalidResponse,
  dependencyUnavailable,
} from "./public-route-utils";

const Timestamp = z.string().datetime({ offset: true });
const UpstreamJelly = z
  .object({
    id: z.string().min(1),
    revision: z.number().int().nonnegative(),
    state: z.literal("ready"),
    visibility: z.literal("public"),
    moderationStatus: z.literal("clear"),
    postType: z.string(),
    durationSeconds: z.number().nonnegative(),
    author: z
      .object({
        id: z.string(),
        username: z.string(),
        displayName: z.string(),
        avatarUrl: z.string(),
      })
      .strict(),
    title: z.string(),
    summary: z.string(),
    thumbnailUrl: z.string(),
    mediaExpiresAt: Timestamp,
    watchUrl: z.string(),
    placeAssociation: z
      .object({
        placeId: z.string(),
        source: z.literal("server_place_relation"),
        associatedAt: Timestamp,
      })
      .strict(),
    postedAt: Timestamp,
    updatedAt: Timestamp,
  })
  .strict();

const UpstreamFeed = z
  .object({
    place: z.object({ id: z.string(), revision: z.number().int().nonnegative() }).strict(),
    jellies: z.array(UpstreamJelly),
    page: z
      .object({
        limit: z.number().int().min(1).max(100),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
    generatedAt: Timestamp,
  })
  .strict();

export type NormalizedJellyFeed = {
  jellies: Array<{
    id: string;
    postType: string;
    author: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string;
    };
    title: string;
    summary: string;
    thumbnailUrl: string;
    mediaExpiresAt: string;
    watchUrl: string;
    postedAt: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
};

function configuration() {
  const baseUrl = process.env.JELLY_API_BASE_URL?.replace(/\/$/, "");
  const partnerKey = process.env.JELLY_PARTNER_API_KEY;
  if (!baseUrl || !partnerKey) {
    throw new JellyhuntV2Error(
      503,
      "service_unconfigured",
      "A required service is not configured.",
    );
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new JellyhuntV2Error(
      503,
      "service_unconfigured",
      "A required service is not configured.",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new JellyhuntV2Error(
      503,
      "service_unconfigured",
      "A required service is not configured.",
    );
  }
  return { baseUrl: url.href.replace(/\/$/, ""), partnerKey };
}

export async function fetchJellyPlaceFeed(args: {
  jellyPlaceId: string;
  upstreamCursor?: string;
  limit: number;
  requestId: string;
}): Promise<NormalizedJellyFeed> {
  const config = configuration();
  const query = new URLSearchParams({ limit: String(args.limit) });
  if (args.upstreamCursor) query.set("cursor", args.upstreamCursor);
  const endpoint =
    config.baseUrl +
    "/partner/v1/jellyhunt/places/" +
    encodeURIComponent(args.jellyPlaceId) +
    "/jellies?" +
    query.toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + config.partnerKey,
        "X-Correlation-Id": args.requestId,
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    throw dependencyUnavailable();
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429 || response.status >= 500) throw dependencyUnavailable();
  if (!response.ok) throw dependencyInvalidResponse();

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw dependencyInvalidResponse();
  }
  const parsed = UpstreamFeed.safeParse(json);
  if (!parsed.success) throw dependencyInvalidResponse();
  if (parsed.data.place.id !== args.jellyPlaceId) throw dependencyInvalidResponse();
  if (parsed.data.page.limit !== args.limit) throw dependencyInvalidResponse();
  if (parsed.data.page.hasMore !== (parsed.data.page.nextCursor !== null)) {
    throw dependencyInvalidResponse();
  }
  if (
    parsed.data.jellies.some(
      (jelly) =>
        jelly.placeAssociation.placeId !== args.jellyPlaceId ||
        Date.parse(jelly.mediaExpiresAt) <= Date.now(),
    )
  ) {
    throw dependencyInvalidResponse();
  }

  return {
    jellies: parsed.data.jellies.map((jelly) => ({
      id: jelly.id,
      postType: jelly.postType,
      author: jelly.author,
      title: jelly.title,
      summary: jelly.summary,
      thumbnailUrl: jelly.thumbnailUrl,
      mediaExpiresAt: jelly.mediaExpiresAt,
      watchUrl: jelly.watchUrl,
      postedAt: jelly.postedAt,
    })),
    nextCursor: parsed.data.page.nextCursor,
    hasMore: parsed.data.page.hasMore,
  };
}
