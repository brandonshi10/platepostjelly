import { describe, expect, it } from "vitest";
import {
  JellyhuntV2Error,
  badRequest,
  notFound,
  unauthorized,
  forbidden,
  conflict,
  validationError,
  invalidCursor,
  rateLimited,
  serviceUnavailable,
  submissionConflict,
  internalError,
} from "../src/lib/jellyhunt/v2/errors";
import { wrapError } from "../src/lib/jellyhunt/v2/envelope";

describe("v2 error factories", () => {
  it("badRequest produces 400", () => {
    const err = badRequest("missing_field", "name is required");
    expect(err).toBeInstanceOf(JellyhuntV2Error);
    expect(err.statusCode).toBe(400);
    expect(err.errorCode).toBe("missing_field");
  });

  it("unauthorized produces 401", () => {
    const err = unauthorized();
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe("unauthorized");
  });

  it("forbidden produces 403", () => {
    const err = forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.errorCode).toBe("forbidden");
  });

  it("notFound produces 404", () => {
    const err = notFound("mission");
    expect(err.statusCode).toBe(404);
    expect(err.errorCode).toBe("not_found");
    expect(err.message).toBe("mission not found");
  });

  it("conflict produces 409 with caller-specified code", () => {
    const err = conflict("duplicate_entry", "already exists");
    expect(err.statusCode).toBe(409);
    expect(err.errorCode).toBe("duplicate_entry");
  });

  it("submissionConflict produces privacy-safe 409", () => {
    const err = submissionConflict();
    expect(err.statusCode).toBe(409);
    expect(err.errorCode).toBe("submission_conflict");
    expect(err.message).not.toMatch(/post|reuse|already submitted/i);
  });

  it("validationError produces 422", () => {
    const err = validationError("latitude out of range");
    expect(err.statusCode).toBe(422);
    expect(err.errorCode).toBe("validation_error");
  });

  it("invalidCursor produces 400 with restart hint", () => {
    const err = invalidCursor();
    expect(err.statusCode).toBe(400);
    expect(err.errorCode).toBe("invalid_cursor");
  });

  it("rateLimited produces 429", () => {
    const err = rateLimited();
    expect(err.statusCode).toBe(429);
    expect(err.errorCode).toBe("rate_limited");
  });

  it("internalError produces 500", () => {
    const err = internalError();
    expect(err.statusCode).toBe(500);
    expect(err.errorCode).toBe("internal_error");
  });

  it("serviceUnavailable produces 503", () => {
    const err = serviceUnavailable();
    expect(err.statusCode).toBe(503);
    expect(err.errorCode).toBe("service_unavailable");
  });
});

describe("v2 error envelope", () => {
  it("wraps error with requestId and apiVersion", () => {
    const envelope = wrapError("not_found", "mission not found", "req-123");
    expect(envelope.error.code).toBe("not_found");
    expect(envelope.error.requestId).toBe("req-123");
    expect(envelope.meta.apiVersion).toBe("2.0");
    expect(envelope.meta.requestId).toBe("req-123");
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.error.details).toEqual([]);
  });

  it("marks 5xx and 429 as retryable", () => {
    const retryable = wrapError("rate_limited", "slow down", "r1", { retryable: true });
    expect(retryable.error.retryable).toBe(true);
  });

  it("sets restartRequired for cursor errors", () => {
    const envelope = wrapError("invalid_cursor", "bad cursor", "r2", { restartRequired: true });
    expect(envelope.error.restartRequired).toBe(true);
  });
});
