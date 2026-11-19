import { NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/gmail';

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID === 'your-google-client-id.apps.googleusercontent.com'
  ) {
    return NextResponse.redirect(`${appUrl}?error=missing_google_client_id`);
  }

  const authUrl = getGoogleAuthUrl();
  return NextResponse.redirect(authUrl);
}
