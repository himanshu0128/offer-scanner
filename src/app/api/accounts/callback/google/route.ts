import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleOAuthClient } from '@/lib/gmail';
import { prisma } from '@/lib/prisma';
import { runOfferScan } from '@/lib/scanner';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!code) {
    return NextResponse.redirect(`${appUrl}?error=missing_oauth_code`);
  }

  try {
    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      return NextResponse.redirect(`${appUrl}?error=missing_email_scope`);
    }

    const account = await prisma.emailAccount.upsert({
      where: { email },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
        provider: 'google',
        status: 'active',
      },
      create: {
        email,
        provider: 'google',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
        status: 'active',
      },
    });

    // Scan last 30 days immediately upon connecting the account
    await runOfferScan('manual', account.id);

    return NextResponse.redirect(`${appUrl}?connected=${encodeURIComponent(email)}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return NextResponse.redirect(`${appUrl}?error=oauth_failed`);
  }
}
