import { z } from "zod";
import { dependencyUnavailable, JellyhuntV2Error } from "./errors";
import type { V2RouteContext } from "./route-handler";

export { dependencyUnavailable };

export function invalidRequest(message = "The request is invalid."): JellyhuntV2Error {
  return new JellyhuntV2Error(400, "invalid_request", message);
}

export function resourceNotFound(
  resource: "campaign" | "mission" | "place",
): JellyhuntV2Error {
  const labels = {
    campaign: "The current campaign does not exist.",
    mission: "This mission does not exist.",
    place: "This place does not exist.",
  };
  return new JellyhuntV2Error(404, `${resource}_not_found`, labels[resource]);
}

export function dependencyInvalidResponse(): JellyhuntV2Error {
  return new JellyhuntV2Error(
    502,
    "dependency_invalid_response",
    "A required dependency returned an invalid response.",
  );
}

function searchParamsRecord(searchParams: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    if (values.length !== 1) throw invalidRequest();
    result[key] = values[0] ?? "";
  }
  return result;
}

export function parseQuery<T>(
  request: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  const parsed = schema.safeParse(searchParamsRecord(new URL(request.url).searchParams));
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

export async function parseRouteParams<
  T,
  P extends Record<string, string>,
>(
  context: V2RouteContext<P>,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const raw = await context.params;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

export function isoTimestamp(value: string | number): string {
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

export function directionsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}
