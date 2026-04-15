import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { UnauthorizedError, AppError } from '../../utils/errors';
import logger from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SigningTokenPayload {
  contractId: string;
  iat?: number;
  exp?: number;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Create a short-lived JWT for the signing link.
 * The token encodes the contractId and expires in `expiresInDays` days.
 */
export function createSigningToken(
  contractId: string,
  expiresInDays = 7
): string {
  // jsonwebtoken's StringValue type accepts e.g. "7d"
  const expiresIn = `${expiresInDays}d` as `${number}d`;

  const token = jwt.sign(
    { contractId } as Pick<SigningTokenPayload, 'contractId'>,
    config.jwt.secret as string,
    {
      expiresIn,
      issuer: 'contractflow',
      audience: 'signing',
    } as jwt.SignOptions
  );

  logger.debug('Signing token created', {
    contractId,
    expiresInDays,
  });

  return token;
}

/**
 * Verify a signing token and return its payload.
 * Throws UnauthorizedError if invalid or expired.
 */
export function verifySigningToken(token: string): { contractId: string } {
  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      issuer: 'contractflow',
      audience: 'signing',
    }) as SigningTokenPayload;

    if (!payload.contractId) {
      throw new AppError('Token missing contractId claim', 400);
    }

    return { contractId: payload.contractId };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Signing link has expired. Please request a new link.');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid signing token.');
    }
    // Re-throw AppErrors we threw ourselves
    throw err;
  }
}

/**
 * Build the full public signing URL from a token.
 */
export function getSigningLink(token: string): string {
  const base = config.signing.linkBaseUrl.replace(/\/$/, '');
  return `${base}/sign/${token}`;
}

/**
 * Decode a token without verifying (for safe inspection).
 * Returns null if the token is malformed.
 */
export function decodeSigningToken(token: string): SigningTokenPayload | null {
  try {
    return jwt.decode(token) as SigningTokenPayload | null;
  } catch {
    return null;
  }
}

/**
 * Calculate the expiry Date from a token's 'exp' claim.
 */
export function getTokenExpiry(token: string): Date | null {
  const decoded = decodeSigningToken(token);
  if (!decoded?.exp) return null;
  return new Date(decoded.exp * 1000);
}
