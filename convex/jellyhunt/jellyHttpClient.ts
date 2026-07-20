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
  authorizationScheme?: "Token" | "Bearer";
};

const DEFAULT_TIMEOUT_MS = 10_000;

/** Reads `JELLY_API_BASE_URL`/`JELLY_API_TOKEN` from the environment. */
export function getJellyHttpConfig(): JellyHttpConfig {
  return {
    baseUrl: process.env.JELLY_API_BASE_URL ?? "",
    apiToken: process.env.JELLY_API_TOKEN ?? "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    authorizationScheme: "Token",
  };
}

/** Versioned Jelly partner transport used for evidence and reward intents. */
export function getJellyPartnerHttpConfig(): JellyHttpConfig {
  const configuredTimeout = Number(process.env.JELLY_PARTNER_TIMEOUT_MS);
  return {
    baseUrl: (process.env.JELLY_PARTNER_API_BASE_URL ?? "").replace(/\/$/, ""),
    apiToken: process.env.JELLY_PARTNER_API_KEY ?? "",
    timeoutMs:
      Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000 && configuredTimeout <= 30_000
        ? configuredTimeout
        : DEFAULT_TIMEOUT_MS,
    authorizationScheme: "Bearer",
  };
}

export function partnerTransportIsUsable(config: JellyHttpConfig): boolean {
  if (!config.baseUrl || !config.apiToken) return false;
  if (process.env.NODE_ENV === "production" && !config.baseUrl.startsWith("https://")) return false;
  return /^https?:\/\//.test(config.baseUrl);
}

function buildHeaders(config: JellyHttpConfig, correlationId?: string, isPost?: boolean, extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `${config.authorizationScheme ?? "Token"} ${config.apiToken}`,
  };
  if (correlationId) headers["X-Correlation-Id"] = correlationId;
  if (isPost) headers["Content-Type"] = "application/json";
  return { ...headers, ...extraHeaders };
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
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return performRequest(config, path, {
    method: "POST",
    headers: buildHeaders(config, correlationId, true, extraHeaders),
    body: JSON.stringify(payload),
  });
}
