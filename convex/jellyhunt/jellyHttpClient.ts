/**
 * Minimal HTTP transport for calling the external Jelly partner API from
 * JellyHunt Convex actions (`convex/jellyhunt/profiles.ts`,
 * `convex/jellyhunt/verification.ts`). Kept deliberately dumb (no retries,
 * no response parsing) so callers can layer their own interpretation of
 * status codes/bodies on top, and so it stays easy to fake in tests.
 */

export type JellyHttpConfig = {
  baseUrl: string;
  apiToken: string;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/** Reads `JELLY_API_BASE_URL`/`JELLY_API_TOKEN` from the environment. */
export function getJellyHttpConfig(): JellyHttpConfig {
  return {
    baseUrl: process.env.JELLY_API_BASE_URL ?? "",
    apiToken: process.env.JELLY_API_TOKEN ?? "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function buildHeaders(config: JellyHttpConfig, correlationId?: string, isPost?: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Token ${config.apiToken}`,
  };
  if (correlationId) headers["X-Correlation-Id"] = correlationId;
  if (isPost) headers["Content-Type"] = "application/json";
  return headers;
}

async function performRequest(
  config: JellyHttpConfig,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return { status: 0, body: { error: "timeout" } };
    }
    return { status: 0, body: { error: "network_error" } };
  } finally {
    clearTimeout(timeout);
  }
}

export async function jellyGet(
  config: JellyHttpConfig,
  path: string,
  correlationId?: string,
): Promise<{ status: number; body: any }> {
  return performRequest(config, path, {
    method: "GET",
    headers: buildHeaders(config, correlationId, false),
  });
}

export async function jellyPost(
  config: JellyHttpConfig,
  path: string,
  payload: any,
  correlationId?: string,
): Promise<{ status: number; body: any }> {
  return performRequest(config, path, {
    method: "POST",
    headers: buildHeaders(config, correlationId, true),
    body: JSON.stringify(payload),
  });
}
