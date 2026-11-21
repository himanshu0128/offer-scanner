import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function getGoogleOAuthClient(originOverride?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim().replace(/^["']|["']$/g, '');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim().replace(/^["']|["']$/g, '');
  const appUrl =
    originOverride ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/^["']|["']$/g, '') ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000');
  const redirectUri = `${appUrl.replace(/\/$/, '')}/api/accounts/callback/google`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGoogleAuthUrl(state?: string, originOverride?: string) {
  const oauth2Client = getGoogleOAuthClient(originOverride);
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

export interface FetchPromotionalEmailsResult {
  totalMatchingIn30Days: number;
  newEmailsFetched: RawEmailMessage[];
}

/**
 * Fetches ALL promotional/offer emails from the last 30 days for a connected Gmail account
 * using full pagination (`nextPageToken`) and pre-fetch deduplication (`knownMessageIds`).
 */
export async function fetchLast30DaysPromotionalEmails(
  accessToken: string,
  refreshToken?: string | null,
  onTokenRefreshed?: (newAccessToken: string, expiryDate?: number | null) => Promise<void>,
  knownMessageIds?: Set<string>
): Promise<FetchPromotionalEmailsResult> {
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

  // Precision 30-day promotional query with explicit transactional/OTP noise exclusions
  const query = [
    'newer_than:30d',
    '(category:promotions OR "% off" OR "$ off" OR "promo code" OR "use code" OR "coupon" OR "free shipping" OR "flash sale" OR "bogo")',
    '-subject:("verification code" OR "security code" OR "login code" OR "passcode" OR "one-time" OR "OTP" OR "order confirmation" OR "receipt" OR "invoice" OR "shipped" OR "delivered" OR "password reset" OR "security alert" OR "two-factor" OR "2-step")',
  ].join(' ');

  // 1. Paginate through ALL matching message IDs in the 30-day window (up to 500 per page)
  const allMessageIds: string[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const listRes: any = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      pageToken,
    });

    const pageMessages = listRes.data.messages || [];
    for (const m of pageMessages) {
      if (m.id) allMessageIds.push(m.id);
    }

    pageToken = listRes.data.nextPageToken || undefined;
  } while (pageToken);

  // 2. Skip messages we have already scanned into PostgreSQL before making detail API calls
  const idsToFetch = knownMessageIds
    ? allMessageIds.filter((id) => !knownMessageIds.has(id))
    : allMessageIds;

  // 3. Fetch message details in high-throughput parallel batches of 25
  const results: RawEmailMessage[] = [];
  const batchSize = 25;

  for (let i = 0; i < idsToFetch.length; i += batchSize) {
    const batch = idsToFetch.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (msgId) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msgId,
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
          const snippet = decodeHtmlEntities(detail.data.snippet || '');
          const bodyText = decodeHtmlEntities(
            extractPlainTextFromPayload(detail.data.payload) || snippet
          );

          return {
            messageId: msgId,
            from,
            subject: decodeHtmlEntities(subject),
            snippet,
            bodyText: bodyText.slice(0, 3500),
            receivedAt,
          } as RawEmailMessage;
        } catch (err) {
          console.error(`Failed to fetch message ${msgId}:`, err);
          return null;
        }
      })
    );

    for (const item of batchResults) {
      if (item) results.push(item);
    }
  }

  return {
    totalMatchingIn30Days: allMessageIds.length,
    newEmailsFetched: results,
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractPlainTextFromPayload(payload: any): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      const text = extractPlainTextFromPayload(part);
      if (text) return text;
    }
  }

  if (payload.body?.data) {
    const rawHtml = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    return rawHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}
