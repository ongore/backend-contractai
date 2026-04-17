import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { noContent, success, error as sendApiError } from '../utils/response';
import { NotFoundError } from '../utils/errors';
import logger from '../utils/logger';
import { supabaseAnon } from '../config/supabase';

/**
 * POST /api/auth/send-otp
 * Sends a one-time email code to the given address via Supabase.
 */
export async function sendOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { phone } = req.body as { phone?: string };

    if (!phone) {
      sendApiError(res, 'Phone number is required', 400);
      return;
    }

    const { error } = await supabaseAnon.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true },
    });

    if (error) {
      logger.warn('Supabase send OTP failed', { phone, error: error.message });
      sendApiError(res, error.message, 400);
      return;
    }

    success(res, { message: 'OTP sent', phone });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/verify-otp
 * Verifies an email OTP and returns an auth session.
 * Includes isNewUser: true when this is the user's first successful verification.
 */
export async function verifyOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { phone, token } = req.body as { phone?: string; token?: string };

    if (!phone || !token) {
      sendApiError(res, 'Phone number and token are required', 400);
      return;
    }

    const { data, error } = await supabaseAnon.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });

    if (error || !data.session || !data.user) {
      const msg = error?.message ?? 'Invalid or expired code';
      logger.warn('Supabase verify OTP failed', { phone, error: msg });
      sendApiError(res, msg, 401);
      return;
    }

    const supaUser = data.user;
    const session  = data.session;

    const existingUser = await prisma.user.findUnique({ where: { id: supaUser.id } });
    const isNewUser    = existingUser === null;

    const user = await prisma.user.upsert({
      where: { id: supaUser.id },
      create: {
        id:    supaUser.id,
        phone: supaUser.phone ?? phone,
        email: supaUser.email ?? undefined,
        name:  null,
      },
      update: {
        phone: supaUser.phone ?? phone,
        ...(supaUser.email ? { email: supaUser.email } : {}),
      },
    });

    success(res, {
      user: {
        id:        user.id,
        email:     user.email ?? undefined,
        phone:     user.phone ?? undefined,
        name:      user.name ?? undefined,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken:  session.access_token,
      refreshToken: session.refresh_token,
      isNewUser,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/sign-out
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
 * Creates or updates the user's profile (name etc.) after sign-in.
 */
export async function syncUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id, email } = req.user;
    const { name } = req.body as { name?: string };

    const user = await prisma.user.upsert({
      where: { id },
      create: { id, email: email ?? undefined, name: name ?? null },
      update: {
        ...(email              ? { email }  : {}),
        ...(name !== undefined ? { name }   : {}),
      },
    });

    success(res, {
      id:        user.id,
      phone:     user.phone,
      email:     user.email,
      name:      user.name,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
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
        id:        true,
        phone:     true,
        email:     true,
        name:      true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { contracts: true } },
      },
    });

    if (!user) throw new NotFoundError('User');

    success(res, {
      id:            user.id,
      phone:         user.phone,
      email:         user.email,
      name:          user.name,
      createdAt:     user.createdAt,
      updatedAt:     user.updatedAt,
      contractCount: user._count.contracts,
    });
  } catch (err) {
    next(err);
  }
}
