import { randomUUID } from "crypto";

export type V2Envelope<T> = {
  data: T;
  meta: {
    requestId: string;
    generatedAt: string;
  };
};

export type V2ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

export function wrapSuccess<T>(data: T, requestId?: string): V2Envelope<T> {
  return {
    data,
    meta: {
      requestId: requestId ?? randomUUID(),
      generatedAt: new Date().toISOString(),
    },
  };
}

export function wrapError(code: string, message: string, requestId?: string): V2ErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId: requestId ?? randomUUID(),
    },
  };
}
