import type { z } from 'zod';
import { AppError } from '@madar/shared';

function firstIssueMessage(error: z.ZodError): string | undefined {
  const issue = error.issues[0];
  if (!issue) return undefined;
  return `${issue.path.join('.') || 'value'}: ${issue.message}`;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw AppError.badRequest(
      'validation_error',
      'Invalid request body',
      firstIssueMessage(result.error),
    );
  }
  return result.data;
}

export function parseParams<T extends z.ZodTypeAny>(schema: T, params: unknown): z.infer<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw AppError.badRequest(
      'validation_error',
      'Invalid route parameters',
      firstIssueMessage(result.error),
    );
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw AppError.badRequest(
      'validation_error',
      'Invalid query parameters',
      firstIssueMessage(result.error),
    );
  }
  return result.data;
}
