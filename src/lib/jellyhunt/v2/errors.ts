export class JellyhuntV2Error extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "JellyhuntV2Error";
  }
}

export function notFound(resource: string): JellyhuntV2Error {
  return new JellyhuntV2Error(404, "not_found", `${resource} not found`);
}

export function unauthorized(): JellyhuntV2Error {
  return new JellyhuntV2Error(401, "unauthorized", "Authentication required");
}

export function forbidden(): JellyhuntV2Error {
  return new JellyhuntV2Error(403, "forbidden", "Insufficient permissions");
}

export function conflict(code: string, message: string): JellyhuntV2Error {
  return new JellyhuntV2Error(409, code, message);
}

export function validationError(message: string): JellyhuntV2Error {
  return new JellyhuntV2Error(422, "validation_error", message);
}

export function rateLimited(): JellyhuntV2Error {
  return new JellyhuntV2Error(429, "rate_limited", "Too many requests");
}

export function internalError(): JellyhuntV2Error {
  return new JellyhuntV2Error(500, "internal_error", "An internal error occurred");
}
