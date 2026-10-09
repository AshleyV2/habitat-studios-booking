import type { z } from 'zod';
import { AppError } from './errors';

/** Parse untrusted input with a Zod schema, throwing a 400 with field messages on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new AppError(400, 'validation_error', 'Some fields need attention.', fields);
}
