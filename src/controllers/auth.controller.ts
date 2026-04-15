import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { noContent, success, error as sendApiError } from '../utils/response';
import { NotFoundError } from '../utils/errors';
import logger from '../utils/logger';
import { supabaseAnon } from '../config/supabase';

/**
 * POST /api/auth/send-otp
 * Sends a one-time code to the given email address using Supabase OTP.
 */
export async function sendOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email } = req.body as { email?: string };

    if (!email) {
      sendApiError(res, 'Email is required', 400);
      return;
    }

    const { error } = await supabaseAnon.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      logger.warn('Supabase send OTP failed', { email, error: error.message });
      sendApiError(res, error.message, 400);
      return;
    }

    success(res, { message: 'OTP sent', email });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/verify-otp
 * Verifies an OTP and returns an auth session for the mobile client.
 */
export async function verifyOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, otp } = req.body as { email?: string; otp?: string };

    if (!email || !otp) {
      sendApiError(res, 'Email and OTP are required', 400);
      return;
    }

    const { data, error } = await supabaseAnon.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });

    if (error || !data.session || !data.user) {
      const msg = error?.message ?? 'Invalid OTP';
      logger.warn('Supabase verify OTP failed', { email, error: msg });
      sendApiError(res, msg, 401);
      return;
    }

    const supaUser = data.user;
    const session = data.session;

    // Ensure a corresponding DB user exists for app data ownership.
    const user = await prisma.user.upsert({
      where: { id: supaUser.id },
      create: {
        id: supaUser.id,
        email: supaUser.email ?? email,
        name: null,
      },
      update: {
        email: supaUser.email ?? email,
      },
    });

    success(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/sign-out
 * There is no server-side session to invalidate for JWT-based auth.
 */
export async function signOut(
  _req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  noContent(res);
}

/**
 * DELETE /api/auth/delete-account
 * Deletes the current user (cascades contracts via FK).
 */
export async function deleteAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.user;

    await prisma.user.delete({ where: { id } });
    noContent(res);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/sync
 * Creates or updates the user record in the database using the
 * identity from the Supabase JWT (set by the auth middleware).
 *
 * Call this after a successful Supabase sign-in/sign-up from the mobile app.
 */
export async function syncUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id, email } = req.user;
    const { name } = req.body as { name?: string };

    logger.debug('Syncing user', { userId: id, email });

    const user = await prisma.user.upsert({
      where: { id },
      create: {
        id,
        email,
        name: name ?? null,
      },
      update: {
        email, // Keep email in sync in case it was updated in Supabase
        ...(name !== undefined && { name }),
      },
    });

    logger.info('User synced', { userId: user.id, email: user.email });

    success(res, {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Returns the current authenticated user's profile from the database.
 */
export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.user;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { contracts: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    success(res, {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      contractCount: user._count.contracts,
    });
  } catch (err) {
    next(err);
  }
}
