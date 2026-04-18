import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { prisma } from '../config/prisma';
import { UnauthorizedError } from '../utils/errors';
import logger from '../utils/logger';

const DEV_USER_ID = 'dev-user-00000000-0000-0000-0000-000000000001';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Dev bypass — skip auth entirely in development
    if (config.isDev) {
      await prisma.user.upsert({
        where:  { id: DEV_USER_ID },
        create: { id: DEV_USER_ID, name: 'Dev User', phone: '+10000000000' },
        update: {},
      });
      req.user = { id: DEV_USER_ID, email: 'dev@clerra.app' };
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
    } catch (err) {
      logger.debug('JWT validation failed', { error: (err as Error).message });
      throw new UnauthorizedError('Invalid or expired token');
    }

    if (!payload.sub) {
      throw new UnauthorizedError('Invalid token payload');
    }

    req.user = {
      id:    payload.sub,
      email: payload.email ?? '',
    };

    next();
  } catch (err) {
    next(err);
  }
}
