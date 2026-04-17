import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { UnauthorizedError } from '../utils/errors';
import logger from '../utils/logger';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7); // strip "Bearer "

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.debug('Supabase token validation failed', { error: error?.message });
      throw new UnauthorizedError('Invalid or expired token');
    }

    req.user = {
      id: user.id,
      email: user.email ?? '',
    };

    next();
  } catch (err) {
    next(err);
  }
}
