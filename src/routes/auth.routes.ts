import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  syncUser,
  getMe,
  sendOtp,
  verifyOtp,
  signOut,
  deleteAccount,
} from '../controllers/auth.controller';

const router = Router();

/**
 * POST /api/auth/send-otp
 * Sends a one-time code to the user's email (Supabase OTP).
 */
router.post('/send-otp', sendOtp);

/**
 * POST /api/auth/verify-otp
 * Verifies the one-time code and returns an auth session.
 */
router.post('/verify-otp', verifyOtp);

/**
 * POST /api/auth/sync
 * Creates or updates the user record after Supabase sign-in.
 * Body (optional): { name: string }
 */
router.post('/sync', authenticate, syncUser);

/**
 * GET /api/auth/me
 * Returns the current authenticated user's profile.
 */
router.get('/me', authenticate, getMe);

/**
 * POST /api/auth/sign-out
 * Client-side sign-out helper endpoint (no server session to invalidate).
 */
router.post('/sign-out', signOut);

/**
 * DELETE /api/auth/delete-account
 * Deletes the current user and cascades related data.
 */
router.delete('/delete-account', authenticate, deleteAccount);

export default router;
