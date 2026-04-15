import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Singleton pattern: reuse the same client across hot reloads in dev
const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { level: 'query', emit: 'event' },
            { level: 'error', emit: 'stdout' },
            { level: 'warn', emit: 'stdout' },
          ]
        : [{ level: 'error', emit: 'stdout' }],
  });

if (process.env.NODE_ENV === 'development') {
  global.__prisma = prisma;

  // Log queries in dev
  (prisma as any).$on('query', (e: { query: string; duration: number }) => {
    logger.debug(`Prisma Query: ${e.query} (${e.duration}ms)`);
  });
}

export { prisma };
