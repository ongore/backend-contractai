import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { config } from '../config/env';
import { noContent, success, error as sendApiError } from '../utils/response';
import { NotFoundError } from '../utils/errors';
import logger from '../utils/logger';
import { sendVerification, checkVerification } from '../services/sms/twilioService';

/**
 * POST /api/auth/send-otp
 * Sends a one-time SMS code via Twilio Verify.
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

    await sendVerification(phone);
    success(res, { message: 'OTP sent', phone });
  } catch (err: any) {
    logger.warn('Twilio send OTP failed', { error: err?.message });
    next(err);
  }
}

/**
 * POST /api/auth/verify-otp
 * Verifies an SMS OTP via Twilio, then issues a signed JWT.
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

    const approved = await checkVerification(phone, token);
    if (!approved) {
      logger.warn('Twilio verify OTP rejected', { phone });
      sendApiError(res, 'Invalid or expired code', 401);
      return;
    }

    const user = await prisma.user.upsert({
      where: { phone },
      create: { phone, name: null },
      update: {},
    });

    const isNewUser = !user.name;

    const accessToken = jwt.sign(
      { sub: user.id, phone: user.phone },
      config.jwt.secret,
      { expiresIn: '90d' },
    );

    success(res, {
      user: {
        id:        user.id,
        email:     user.email ?? undefined,
        phone:     user.phone ?? undefined,
        name:      user.name ?? undefined,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
      refreshToken: null,
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
    const { id } = req.user;
    const { name, email } = req.body as { name?: string; email?: string };

    const user = await prisma.user.upsert({
      where: { id },
      create: { id, email: email ?? undefined, name: name ?? null },
      update: {
        ...(email !== undefined ? { email } : {}),
        ...(name  !== undefined ? { name }  : {}),
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
