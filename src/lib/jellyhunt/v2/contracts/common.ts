import { z } from "zod";

export const PaginationParams = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type PaginationParams = z.infer<typeof PaginationParams>;

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const EnvelopeMeta = z.object({
  requestId: z.string(),
  generatedAt: z.string(),
});
export type EnvelopeMeta = z.infer<typeof EnvelopeMeta>;

export function successEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    meta: EnvelopeMeta,
  });
}

export const PaginatedMeta = z.object({
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
});
export type PaginatedMeta = z.infer<typeof PaginatedMeta>;
