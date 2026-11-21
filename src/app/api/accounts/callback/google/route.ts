import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleOAuthClient } from '@/lib/gmail';
import { prisma } from '@/lib/prisma';
import { runOfferScan } from '@/lib/scanner';
import { encryptToken, timingSafeEqualStr } from '@/lib/crypto';
import {
  createSessionToken,
  getSessionFromRequest,
  SESSION_COOKIE_NAME,
} from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const storedState = req.cookies.get('oauth_state')?.value;
  const appUrl = req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${appUrl}?error=missing_oauth_code`);
  }

  // Verify OAuth 2.0 CSRF state parameter if cookie is present on same host
  if (storedState && (!state || !timingSafeEqualStr(state, storedState))) {
    return NextResponse.redirect(`${appUrl}?error=invalid_oauth_state`);
  }

  try {
    const oauth2Client = getGoogleOAuthClient(appUrl);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      return NextResponse.redirect(`${appUrl}?error=missing_email_scope`);
    }

    // Check if a user is already logged in (connecting a 2nd/3rd email account)
    // Otherwise create or sign in the primary User record for this Google account
    const existingSession = getSessionFromRequest(req);
    let userId: string;
    let sessionUserEmail: string;
    let sessionUserName: string | null | undefined;
    let sessionUserPicture: string | null | undefined;

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name: userInfo.data.name || undefined,
        picture: userInfo.data.picture || undefined,
      },
      create: {
        email,
        name: userInfo.data.name || email.split('@')[0],
        picture: userInfo.data.picture || null,
      },
    });

    if (existingSession) {
      userId = existingSession.userId;
      sessionUserEmail = existingSession.email;
      sessionUserName = existingSession.name;
      sessionUserPicture = existingSession.picture;
    } else {
      // If this Gmail address is already linked as an EmailAccount to an existing User, sign into that User
      const existingLinkedAccount = await prisma.emailAccount.findUnique({
        where: { email },
        include: { user: true },
      });

      if (existingLinkedAccount?.userId && existingLinkedAccount.user) {
        userId = existingLinkedAccount.userId;
        sessionUserEmail = existingLinkedAccount.user.email;
        sessionUserName = existingLinkedAccount.user.name;
        sessionUserPicture = existingLinkedAccount.user.picture;
      } else {
        userId = user.id;
        sessionUserEmail = user.email;
        sessionUserName = user.name;
        sessionUserPicture = user.picture;
      }
    }

    const encryptedAccess = encryptToken(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : undefined;

    const account = await prisma.emailAccount.upsert({
      where: { email },
      update: {
        userId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
        provider: 'google',
        status: 'active',
      },
      create: {
        userId,
        email,
        provider: 'google',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh || null,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
        status: 'active',
      },
    });

    // Scan last 30 days only if this account hasn't been scanned in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (!account.lastScanned || account.lastScanned < tenMinutesAgo) {
      runOfferScan('manual', account.id).catch((err) =>
        console.error('Background initial scan error:', err)
      );
    }

    const sessionToken = createSessionToken({
      userId,
      email: sessionUserEmail,
      name: sessionUserName,
      picture: sessionUserPicture,
    });

    const response = NextResponse.redirect(
      `${appUrl}?connected=${encodeURIComponent(email)}`
    );
    response.cookies.delete('oauth_state');
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return response;
  } catch (error: any) {
    console.error('Google OAuth callback error:', error);
    const errMsg = error?.message || 'unknown';
    return NextResponse.redirect(
      `${appUrl}?error=${encodeURIComponent(`oauth_failed: ${errMsg}`)}`
    );
  }
}
