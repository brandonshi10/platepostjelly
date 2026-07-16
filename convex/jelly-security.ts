export type PartnerVerificationOutcome = "verified" | "needs_review" | "rejected";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type Location = Coordinates & {
  geofenceRadiusMeters: number;
};

const MINIMUM_DISTANCE_TOLERANCE_METERS = 25;
const RELATIVE_DISTANCE_TOLERANCE = 0.1;

function validCoordinates(value: Coordinates | undefined): value is Coordinates {
  return Boolean(
    value &&
      Number.isFinite(value.latitude) &&
      value.latitude >= -90 &&
      value.latitude <= 90 &&
      Number.isFinite(value.longitude) &&
      value.longitude >= -180 &&
      value.longitude <= 180,
  );
}

function haversineMeters(left: Coordinates, right: Coordinates) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left.latitude)) *
      Math.cos(radians(right.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluatePartnerLocationProof(input: {
  outcome: PartnerVerificationOutcome;
  coordinates?: Coordinates;
  suppliedDistanceMeters?: number;
  location: Location;
}): {
  outcome: PartnerVerificationOutcome;
  distanceMeters?: number;
  reason?: string;
} {
  const coordinates = validCoordinates(input.coordinates)
    ? input.coordinates
    : undefined;
  const suppliedDistanceMeters =
    input.suppliedDistanceMeters !== undefined &&
    Number.isFinite(input.suppliedDistanceMeters) &&
    input.suppliedDistanceMeters >= 0
      ? input.suppliedDistanceMeters
      : undefined;
  const calculatedDistance = coordinates
    ? haversineMeters(coordinates, input.location)
    : undefined;

  if (input.outcome !== "verified") {
    return {
      outcome: input.outcome,
      distanceMeters: calculatedDistance ?? suppliedDistanceMeters,
    };
  }

  if (!coordinates || suppliedDistanceMeters === undefined || calculatedDistance === undefined) {
    return {
      outcome: "needs_review",
      distanceMeters: calculatedDistance,
      reason: "incomplete_partner_location_proof",
    };
  }

  const tolerance = Math.max(
    MINIMUM_DISTANCE_TOLERANCE_METERS,
    calculatedDistance * RELATIVE_DISTANCE_TOLERANCE,
  );
  if (Math.abs(suppliedDistanceMeters - calculatedDistance) > tolerance) {
    return {
      outcome: "needs_review",
      distanceMeters: calculatedDistance,
      reason: "inconsistent_partner_location_proof",
    };
  }

  if (calculatedDistance > input.location.geofenceRadiusMeters) {
    return {
      outcome: "rejected",
      distanceMeters: calculatedDistance,
      reason: "outside_geofence",
    };
  }

  return { outcome: "verified", distanceMeters: calculatedDistance };
}

export function requireCredentialedEndpoint(
  input: string,
  environment = process.env.NODE_ENV ?? "production",
) {
  const value = input.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Credential-bearing endpoint must be a valid HTTP(S) URL");
  }

  if (url.protocol === "https:") return value;
  if (url.protocol !== "http:") {
    throw new Error("Credential-bearing endpoint must use HTTP(S)");
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (environment !== "production" && loopback) return value;

  throw new Error("Credential-bearing endpoint must use HTTPS");
}
