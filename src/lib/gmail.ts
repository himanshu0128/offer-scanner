import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/accounts/callback/google`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGoogleAuthUrl(state?: string) {
  const oauth2Client = getGoogleOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

/**
 * Revokes an OAuth token with Google's OAuth2 revocation endpoint before deleting an account.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    const oauth2Client = getGoogleOAuthClient();
    await oauth2Client.revokeToken(token);
  } catch (err) {
    console.warn('Google token revocation warning (token may already be expired):', err);
  }
}

export interface RawEmailMessage {
  messageId: string;
  from: string;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: Date;
}

/**
 * Fetches promotional/offer emails from the last 30 days for a connected Gmail account.
 */
export async function fetchLast30DaysPromotionalEmails(
  accessToken: string,
  refreshToken?: string | null,
  onTokenRefreshed?: (newAccessToken: string, expiryDate?: number | null) => Promise<void>
): Promise<RawEmailMessage[]> {
  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken || undefined,
  });

  if (onTokenRefreshed) {
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.access_token) {
        onTokenRefreshed(tokens.access_token, tokens.expiry_date).catch((err) =>
          console.error('Failed to persist refreshed OAuth token:', err)
        );
      }
    });
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Look back 30 days for promotional / offer emails
  const query =
    'newer_than:30d (category:promotions OR "off" OR "discount" OR "promo" OR "code" OR "coupon" OR "deal" OR "sale" OR "offer")';

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  const messages = listRes.data.messages || [];
  const results: RawEmailMessage[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = detail.data.payload?.headers || [];
      const subject =
        headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
      const from =
        headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
      const dateStr =
        headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';

      const receivedAt = dateStr ? new Date(dateStr) : new Date();
      const snippet = detail.data.snippet || '';
      const bodyText = extractPlainTextFromPayload(detail.data.payload) || snippet;

      results.push({
        messageId: msg.id,
        from,
        subject,
        snippet,
        bodyText: bodyText.slice(0, 6000), // Limit context window size for LLM
        receivedAt,
      });
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err);
    }
  }

  return results;
}

function extractPlainTextFromPayload(payload: any): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractPlainTextFromPayload(part);
      if (text) return text;
    }
  }

  if (payload.body?.data) {
    const rawHtml = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    return rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
  }

  return '';
}
