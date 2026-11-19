import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { timingSafeEqualStr } from './crypto';

export const SESSION_COOKIE_NAME = 'inbox_offers_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionUser {
  userId: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  exp: number;
}

function getSessionSecret(): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required for signing auth sessions');
  }
  return secret;
}

/**
 * Signs a tamper-proof HMAC-SHA256 session token (stateless JWT-style payload.signature).
 */
export function createSessionToken(user: Omit<SessionUser, 'exp'>): string {
  const payload: SessionUser = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * Verifies an HMAC-SHA256 session token and returns the authenticated user or null.
 */
export function verifySessionToken(token: string | undefined | null): SessionUser | null {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  if (!timingSafeEqualStr(sig, expectedSig)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as SessionUser;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the current logged-in user from a NextRequest cookie.
 */
export function getSessionFromRequest(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}
