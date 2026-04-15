import { validateConfig } from './config/env';

// Validate environment variables before anything else
validateConfig();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env';
import { supabase } from './config/supabase';
import { prisma } from './config/prisma';
import router from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import logger from './utils/logger';

const app = express();

// ─── Security Middleware ───────────────────────────────────────────────────────

app.use(
  helmet({
    // Allow cross-origin requests for the React Native client
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: config.isDev
      ? true // Allow all origins in development
      : [
          'https://contractflow.app',
          'https://sign.contractflow.app',
          /contractflow\.app$/,
        ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ─── Logging Middleware ────────────────────────────────────────────────────────

app.use(
  morgan(config.isDev ? 'dev' : 'combined', {
    stream: {
      write: (message: string) => logger.http(message.trim()),
    },
    // Skip health check logs in production to reduce noise
    skip: (req) => config.isProd && req.url === '/api/health',
  })
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api', router);

// 404 handler for unmatched routes
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Test Supabase connectivity
  try {
    const { error } = await supabase.auth.getSession();
    if (error) {
      logger.warn('Supabase auth check warning (non-fatal)', { error: error.message });
    } else {
      logger.info('Supabase connection verified');
    }
  } catch (err) {
    logger.warn('Could not verify Supabase connection', {
      error: (err as Error).message,
    });
  }

  // Test Prisma / PostgreSQL connectivity
  try {
    await prisma.$connect();
    logger.info('Prisma connected to PostgreSQL');
  } catch (err) {
    logger.error('Failed to connect to PostgreSQL via Prisma', {
      error: (err as Error).message,
    });
    // Don't crash the server — requests will fail individually if DB is down
  }

  app.listen(config.port, () => {
    logger.info(`ContractFlow backend running`, {
      port: config.port,
      env: config.nodeEnv,
      url: `http://localhost:${config.port}/api/health`,
    });
  });
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down gracefully`);

  try {
    await prisma.$disconnect();
    logger.info('Prisma disconnected');
  } catch (err) {
    logger.error('Error during Prisma disconnect', { error: (err as Error).message });
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
  process.exit(1);
});

bootstrap().catch((err) => {
  logger.error('Bootstrap failed', { error: (err as Error).message });
  process.exit(1);
});

export default app;
