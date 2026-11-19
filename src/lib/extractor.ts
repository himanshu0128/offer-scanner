import { GoogleGenAI } from '@google/genai';
import { RawEmailMessage } from './gmail';

export type OfferCategory =
  | 'Fashion'
  | 'Food & Dining'
  | 'Tech'
  | 'Travel'
  | 'Beauty'
  | 'Home'
  | 'Entertainment'
  | 'Other';

export interface ExtractedOffer {
  isOffer: boolean;
  merchantName: string;
  merchantDomain: string | null;
  title: string;
  description: string;
  promoCode: string | null;
  category: OfferCategory;
  discountValue: string | null;
  offerUrl: string | null;
  expiresAt: string | null; // ISO date string if found
}

/**
 * Resolves a clean merchant logo URL from a domain using Clearbit Logo API with Google Favicon fallback.
 */
export function getMerchantLogoUrl(domain: string | null, merchantName: string): string {
  if (domain && domain.includes('.')) {
    const cleanDomain = domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleanDomain)}&sz=128`;
  }
  const guessedDomain = `${merchantName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(guessedDomain)}&sz=128`;
}

/**
 * Extracts structured offer details from a raw email message using Gemini (with heuristic fallback if no API key is configured).
 */
export async function extractOfferFromEmail(
  email: RawEmailMessage
): Promise<ExtractedOffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && apiKey !== 'your-gemini-api-key') {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a precision promotional email parser. Analyze the following email received on ${email.receivedAt.toISOString()} and determine if it contains a consumer promotional offer, discount, coupon, or sale.

Email From: ${email.from}
Email Subject: ${email.subject}
Email Snippet: ${email.snippet}
Email Body:
${email.bodyText}

Respond ONLY with a valid JSON object matching this exact schema:
{
  "isOffer": boolean,
  "merchantName": string,
  "merchantDomain": string | null (e.g. "nike.com"),
  "title": string (short headline, e.g. "25% Off Sitewide"),
  "description": string (1-2 sentence summary of conditions),
  "promoCode": string | null (exact coupon/promo code if present, else null),
  "category": "Fashion" | "Food & Dining" | "Tech" | "Travel" | "Beauty" | "Home" | "Entertainment" | "Other",
  "discountValue": string | null (e.g. "25% OFF", "$20 OFF", "FREE SHIPPING"),
  "offerUrl": string | null,
  "expiresAt": string | null (ISO 8601 date string if an expiration date is mentioned or can be inferred relative to ${email.receivedAt.toISOString()}, otherwise null)
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text) as ExtractedOffer;
        if (!parsed.isOffer) return null;
        return parsed;
      }
    } catch (error) {
      console.warn('Gemini extraction failed, falling back to heuristic parser:', error);
    }
  }

  return fallbackHeuristicExtractor(email);
}

/**
 * Deterministic fallback parser when GEMINI_API_KEY is not yet configured.
 */
function fallbackHeuristicExtractor(email: RawEmailMessage): ExtractedOffer | null {
  const combined = `${email.subject} ${email.snippet} ${email.bodyText}`;
  const offerKeywords = /(% off|\$\d+ off|promo code|use code|discount|coupon|free shipping|bogo|deal|sale)/i;

  if (!offerKeywords.test(combined)) {
    return null;
  }

  // Extract sender name and domain
  // e.g., "Nike <nike@official.nike.com>"
  const fromMatch = email.from.match(/^"?([^"<]+)"?\s*<([^>]+)>/);
  const rawName = fromMatch ? fromMatch[1].trim() : email.from.split('@')[0];
  const emailAddr = fromMatch ? fromMatch[2] : email.from;
  const domainPart = emailAddr.includes('@') ? emailAddr.split('@')[1] : null;
  const rootDomain = domainPart
    ? domainPart.split('.').slice(-2).join('.')
    : null;

  // Look for discount value like "25% OFF" or "$15 OFF"
  const discountMatch = combined.match(/(\d+%\s*OFF|\$\d+\s*OFF|FREE SHIPPING|BOGO)/i);
  const discountValue = discountMatch ? discountMatch[1].toUpperCase() : 'SPECIAL OFFER';

  // Look for promo code patterns like "CODE: SAVE20" or "use code WELCOME15"
  const codeMatch = combined.match(/(?:code|promo|coupon)\s*(?:is|:)?\s*["']?([A-Z0-9_-]{4,15})["']?/i);
  const promoCode = codeMatch ? codeMatch[1].toUpperCase() : null;

  return {
    isOffer: true,
    merchantName: rawName || 'Merchant',
    merchantDomain: rootDomain,
    title: email.subject || `${discountValue} at ${rawName}`,
    description: email.snippet || 'Exclusive promotional offer sent to your inbox.',
    promoCode,
    category: guessCategory(`${rawName} ${combined}`),
    discountValue,
    offerUrl: rootDomain ? `https://${rootDomain}` : null,
    expiresAt: null,
  };
}

function guessCategory(text: string): OfferCategory {
  const lower = text.toLowerCase();
  if (/(shirt|shoe|apparel|wear|nike|adidas|levi|zara|fashion|clothing|dress)/.test(lower)) return 'Fashion';
  if (/(uber eats|doordash|pizza|coffee|restaurant|food|dining|grubhub|starbucks|chipotle)/.test(lower)) return 'Food & Dining';
  if (/(laptop|tech|software|apple|best buy|samsung|headphones|cloud|ai|gaming)/.test(lower)) return 'Tech';
  if (/(flight|hotel|airbnb|airline|travel|marriott|expedia|car rental)/.test(lower)) return 'Travel';
  if (/(sephora|ulta|skincare|makeup|beauty|cosmetics|fragrance)/.test(lower)) return 'Beauty';
  if (/(furniture|home|ikea|wayfair|kitchen|decor|mattress|bed)/.test(lower)) return 'Home';
  if (/(movie|streaming|netflix|spotify|concert|ticket|game)/.test(lower)) return 'Entertainment';
  return 'Other';
}
