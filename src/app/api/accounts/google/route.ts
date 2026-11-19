import { NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/gmail';
import { generateOAuthState } from '@/lib/crypto';

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID === 'your-google-client-id.apps.googleusercontent.com'
  ) {
    return NextResponse.redirect(`${appUrl}?error=missing_google_client_id`);
  }

  // Generate cryptographic CSRF state token and bind it to an HttpOnly cookie
  const state = generateOAuthState();
  const authUrl = getGoogleAuthUrl(state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  });

  return response;
}
