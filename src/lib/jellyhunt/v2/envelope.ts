import { randomUUID } from "crypto";

export type V2MetaExtras = Record<string, unknown>;

export type V2Envelope<T> = {
  data: T;
  meta: {
    apiVersion: "2.0";
    requestId: string;
    generatedAt: string;
  } & V2MetaExtras;
  links?: Record<string, unknown>;
};

export type V2ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details: unknown[];
    restartRequired?: boolean;
  };
  meta: {
    apiVersion: "2.0";
    requestId: string;
    generatedAt: string;
  };
};

export function wrapSuccess<T>(
  data: T,
  requestId: string = randomUUID(),
  options: { meta?: V2MetaExtras; links?: Record<string, unknown> } = {},
): V2Envelope<T> {
  return {
    data,
    meta: {
      apiVersion: "2.0",
      requestId,
      generatedAt: new Date().toISOString(),
      ...(options.meta ?? {}),
    },
    ...(options.links !== undefined ? { links: options.links } : {}),
  };
}

export function wrapError(
  code: string,
  message: string,
  requestId: string = randomUUID(),
  options: { retryable?: boolean; restartRequired?: boolean } = {},
): V2ErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId,
      retryable: options.retryable ?? false,
      details: [],
      ...(options.restartRequired ? { restartRequired: true } : {}),
    },
    meta: {
      apiVersion: "2.0",
      requestId,
      generatedAt: new Date().toISOString(),
    },
  };
}
