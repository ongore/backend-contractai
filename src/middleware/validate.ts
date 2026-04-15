import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { error as sendError } from '../utils/response';

type ValidateTarget = 'body' | 'query' | 'params';

/**
 * Middleware factory that validates req[target] against a Zod schema.
 * Replaces req[target] with the parsed (and coerced) output on success.
 * Returns 400 with structured field errors on failure.
 */
export function validate<T>(
  schema: ZodSchema<T>,
  target: ValidateTarget = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const zodError = result.error as ZodError;
      const fieldErrors = zodError.errors.reduce<Record<string, string[]>>(
        (acc, issue) => {
          const path = issue.path.join('.') || '_root';
          if (!acc[path]) acc[path] = [];
          acc[path].push(issue.message);
          return acc;
        },
        {}
      );

      sendError(res, 'Validation failed', 400, fieldErrors);
      return;
    }

    // Overwrite with parsed/coerced value
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}
