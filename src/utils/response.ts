import { Response } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: unknown;
}

export function success<T>(
  res: Response,
  data: T,
  status = 200,
  message?: string
): Response {
  const body: ApiResponse<T> = {
    success: true,
    data,
  };
  if (message) body.message = message;
  return res.status(status).json(body);
}

export function created<T>(res: Response, data: T, message?: string): Response {
  return success(res, data, 201, message);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function error(
  res: Response,
  message: string,
  status = 400,
  errors?: unknown
): Response {
  const body: ApiResponse = {
    success: false,
    message,
  };
  if (errors !== undefined) body.errors = errors;
  return res.status(status).json(body);
}
