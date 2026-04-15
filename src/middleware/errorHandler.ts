import { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError } from '../utils/errors';
import { error as sendError } from '../utils/response';
import logger from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Operational errors (expected): return clean JSON
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('Operational server error', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
      });
    } else {
      logger.debug('Client error', {
        message: err.message,
        statusCode: err.statusCode,
        path: req.path,
      });
    }

    if (err instanceof ValidationError && err.fields) {
      sendError(res, err.message, err.statusCode, err.fields);
      return;
    }

    sendError(res, err.message, err.statusCode);
    return;
  }

  // Multer errors
  if (err.name === 'MulterError') {
    const multerErr = err as unknown as { code: string; message: string };
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      sendError(
        res,
        `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB ?? 10}MB.`,
        413
      );
      return;
    }
    sendError(res, multerErr.message, 400);
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    sendError(res, 'Invalid token', 401);
    return;
  }
  if (err.name === 'TokenExpiredError') {
    sendError(res, 'Token has expired', 401);
    return;
  }

  // Unknown / programming errors: log fully, return generic message
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
  });

  sendError(
    res,
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
    500
  );
}
