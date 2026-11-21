import { GoogleGenerativeAI } from '@google/generative-ai';
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

// Common English words that often appear after "code" or "promo" in sentences ("use code below", "promo code details")
const FALSE_POSITIVE_PROMO_CODES = new Set([
  'CODE',
  'PROMO',
  'COUPON',
  'BELOW',
  'HERE',
  'TODAY',
  'NOW',
  'APPLIED',
  'CHECKOUT',
  'ONLINE',
  'ONLY',
  'VALID',
  'TERMS',
  'DETAILS',
  'OFFER',
  'OFFERS',
  'DISCOUNT',
  'SAVINGS',
  'REQUIRED',
  'NEEDED',
  'AUTOMATICALLY',
  'AUTO',
  'NONE',
  'NULL',
  'FREE',
  'SHIPPING',
  'SALE',
  'DEAL',
  'DEALS',
  'EMAIL',
  'ACCOUNT',
  'LOGIN',
  'VERIFY',
  'SECURITY',
  'EXPIRES',
  'EXPIRED',
  'LIMIT',
  'LIMITED',
  'MEMBER',
  'MEMBERS',
  'REWARD',
  'REWARDS',
  'CLICK',
  'SHOP',
  'STORE',
  'CARD',
  'GIFT',
  'ORDER',
  'ORDERS',
  'YOUR',
  'WITH',
  'FROM',
  'THIS',
  'THAT',
  'HAVE',
  'MORE',
  'INFO',
  'LINK',
  'PAGE',
  'SITE',
]);

// Transactional / non-offer subject indicators
const NON_OFFER_SUBJECT_REGEX =
  /\b(verification code|security code|login code|one-time|passcode|password reset|order confirmation|your receipt|invoice|payment received|has shipped|out for delivery|delivered|account alert|privacy policy|terms of service|unsubscribe confirm)\b/i;

// Subdomains commonly used by ESPs (Email Service Providers) that shouldn't be treated as the root brand name
const ESP_OR_GENERIC_SUBDOMAINS = new Set([
  'mail',
  'email',
  'emails',
  'e',
  'em',
  'news',
  'newsletter',
  'offers',
  'deals',
  'promo',
  'promotions',
  'info',
  'hello',
  'support',
  'notify',
  'notifications',
  'updates',
  'official',
  'reply',
  'noreply',
  'no-reply',
  'bounce',
  'mktg',
  'marketing',
  ' engage',
  'shop',
  'store',
  'us',
  'go',
  'links',
  'click',
]);

/**
 * Resolves a clean merchant logo URL from a domain using Google high-res favicon service.
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
 * Batch-extracts offers from a list of emails.
 * Uses a single batched Gemini API call per 15 emails if a valid Gemini key is configured,
 * and runs precision deterministic extraction + validation on all results.
 */
export async function extractOffersFromEmailBatch(
  emails: RawEmailMessage[]
): Promise<Map<string, ExtractedOffer | null>> {
  const results = new Map<string, ExtractedOffer | null>();
  if (emails.length === 0) return results;

  // Pre-filter obvious transactional / security emails
  const candidateEmails = emails.filter(
    (e) => !NON_OFFER_SUBJECT_REGEX.test(`${e.subject} ${e.snippet}`)
  );

  const apiKey = process.env.GEMINI_API_KEY?.trim().replace(/^["']|["']$/g, '');

  if (apiKey && apiKey.startsWith('AIza')) {
    const batchSize = 15;
    for (let i = 0; i < candidateEmails.length; i += batchSize) {
      const chunk = candidateEmails.slice(i, i + batchSize);
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          generationConfig: {
            responseMimeType: 'application/json',
          },
        });

        const payloadForPrompt = chunk.map((e) => ({
          messageId: e.messageId,
          receivedAt: e.receivedAt.toISOString(),
          from: e.from,
          subject: e.subject,
          snippet: e.snippet,
          bodyPreview: e.bodyText.slice(0, 1200),
        }));

        const prompt = `You are a high-precision promotional deal & coupon extractor.
Analyze each email in the input array and determine if it is a genuine consumer promotional offer (e.g. % off, $ off, promo code, BOGO, free shipping, flash sale, cashback/bonus reward).
Reject newsletters, security/verification codes, receipts, shipping notifications, and non-promotional updates (set "isOffer": false).

Rules:
- "merchantName": Clean brand name only (e.g. "Nike", "Uber Eats", "Sephora" — strip words like "Official", "Store", "Newsletter", "Team").
- "merchantDomain": Root website domain of the merchant (e.g. "nike.com").
- "promoCode": ONLY include an actual alphanumeric checkout promo/coupon code if explicitly provided (e.g. "SAVE20"). Never put normal words like "BELOW", "HERE", "CHECKOUT", or 6-digit login OTPs. If no code is needed, set null.
- "discountValue": Short badge like "25% OFF", "$20 OFF", "UP TO 50% OFF", "FREE SHIPPING", "BOGO".
- "expiresAt": ISO 8601 timestamp if an expiration date is mentioned or relative to receivedAt, else null.

Input emails:
${JSON.stringify(payloadForPrompt)}

Return a JSON array of objects with this exact schema:
[
  {
    "messageId": string,
    "isOffer": boolean,
    "merchantName": string,
    "merchantDomain": string | null,
    "title": string,
    "description": string,
    "promoCode": string | null,
    "category": "Fashion" | "Food & Dining" | "Tech" | "Travel" | "Beauty" | "Home" | "Entertainment" | "Other",
    "discountValue": string | null,
    "offerUrl": string | null,
    "expiresAt": string | null
  }
]`;

        const res = await model.generateContent(prompt);
        const parsedList = JSON.parse(res.response.text()) as Array<
          ExtractedOffer & { messageId: string }
        >;

        for (const item of parsedList) {
          if (item && item.messageId) {
            const cleanedCode = sanitizePromoCode(item.promoCode);
            results.set(
              item.messageId,
              item.isOffer
                ? {
                    ...item,
                    promoCode: cleanedCode,
                  }
                : null
            );
          }
        }
      } catch (err) {
        console.warn('Batch Gemini extraction failed for chunk, using precision parser:', err);
      }
    }
  }

  // For any email not already processed by Gemini, run the precision heuristic parser
  for (const email of candidateEmails) {
    if (!results.has(email.messageId)) {
      results.set(email.messageId, precisionHeuristicExtractor(email));
    }
  }

  return results;
}

export async function extractOfferFromEmail(
  email: RawEmailMessage
): Promise<ExtractedOffer | null> {
  const batchMap = await extractOffersFromEmailBatch([email]);
  return batchMap.get(email.messageId) ?? null;
}

/**
 * High-precision deterministic extractor that validates real discounts, filters out false-positive codes,
 * normalizes merchant names/domains, and parses expiration dates from the email text.
 */
function precisionHeuristicExtractor(email: RawEmailMessage): ExtractedOffer | null {
  if (NON_OFFER_SUBJECT_REGEX.test(`${email.subject} ${email.snippet}`)) {
    return null;
  }

  const subjectAndSnippet = `${email.subject} ${email.snippet}`;
  const fullText = `${email.subject}\n${email.snippet}\n${email.bodyText}`;

  // 1. Extract concrete discount badge (prioritize Subject & Snippet first, then Body)
  const discountValue =
    extractDiscountBadge(subjectAndSnippet) || extractDiscountBadge(email.bodyText);

  // 2. Extract and strictly validate promo code
  const promoCode =
    extractValidPromoCode(subjectAndSnippet) || extractValidPromoCode(email.bodyText);

  // Require at least a concrete discount badge OR a verified promo code so random newsletters are rejected
  if (!discountValue && !promoCode) {
    return null;
  }

  // 3. Extract clean Merchant Name and Root Domain
  const { merchantName, merchantDomain } = extractCleanMerchant(email.from);

  // 4. Parse expiration date relative to email.receivedAt
  const expiresAt = extractExpirationDate(fullText, email.receivedAt);

  // 5. Build clean headline title & concise summary
  const cleanSubject = email.subject
    .replace(/^(re|fwd):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const title =
    cleanSubject.length > 6
      ? cleanSubject
      : `${discountValue || 'Exclusive Offer'} at ${merchantName}`;

  const description = cleanDescription(email.snippet, cleanSubject);

  return {
    isOffer: true,
    merchantName,
    merchantDomain,
    title,
    description,
    promoCode,
    category: guessCategory(`${merchantName} ${merchantDomain || ''} ${subjectAndSnippet}`),
    discountValue: discountValue || (promoCode ? `CODE: ${promoCode}` : 'SPECIAL OFFER'),
    offerUrl: merchantDomain ? `https://${merchantDomain}` : null,
    expiresAt,
  };
}

function extractDiscountBadge(text: string): string | null {
  const patterns: Array<{ regex: RegExp; format: (m: RegExpMatchArray) => string }> = [
    {
      regex: /\b(up\s+to\s+\d{1,2}%\s*off)\b/i,
      format: (m) => m[1].toUpperCase().replace(/\s+/g, ' '),
    },
    {
      regex: /\b(\d{1,2}%\s*off)\b/i,
      format: (m) => m[1].toUpperCase().replace(/\s+/g, ' '),
    },
    {
      regex: /(\$\d+(?:\.\d{2})?\s*off)\b/i,
      format: (m) => m[1].toUpperCase().replace(/\s+/g, ' '),
    },
    {
      regex: /\b(save\s+\$\d+)\b/i,
      format: (m) => m[1].toUpperCase().replace(/\s+/g, ' '),
    },
    {
      regex: /\b(buy\s+1,?\s*get\s+1(?:\s+free|\s+\d+%\s*off)?|bogo)\b/i,
      format: () => 'BOGO',
    },
    {
      regex: /\b(free\s+(?:standard\s+|express\s+|2-day\s+)?shipping)\b/i,
      format: () => 'FREE SHIPPING',
    },
    {
      regex: /\b(\d{1,2}%\s*cash\s*back)\b/i,
      format: (m) => m[1].toUpperCase().replace(/\s+/g, ' '),
    },
  ];

  for (const { regex, format } of patterns) {
    const match = text.match(regex);
    if (match) return format(match);
  }
  return null;
}

function extractValidPromoCode(text: string): string | null {
  // Match explicit promo code patterns such as:
  // "use code SAVE20", "promo code: FALL15", "coupon code 'WELCOME10'", "enter code VIP25 at checkout"
  const regex =
    /\b(?:promo\s+code|coupon\s+code|discount\s+code|use\s+code|enter\s+code|apply\s+code|with\s+code|code)\s*(?:is|:|-)?\s*["'“”‘’*`]?([A-Z0-9]{4,16})["'“”‘’*`]?\b/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const rawCandidate = match[1];
    // Prefer candidates that were already uppercase in the original email or contain digits
    const isOriginallyUppercase = rawCandidate === rawCandidate.toUpperCase();
    const hasDigit = /\d/.test(rawCandidate);
    if (!isOriginallyUppercase && !hasDigit) {
      continue;
    }

    const sanitized = sanitizePromoCode(rawCandidate);
    if (sanitized) return sanitized;
  }

  return null;
}

function sanitizePromoCode(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const code = candidate.trim().toUpperCase();
  if (code.length < 4 || code.length > 16) return null;
  if (!/^[A-Z0-9_-]+$/.test(code)) return null;
  if (FALSE_POSITIVE_PROMO_CODES.has(code)) return null;
  // Reject pure 4-8 digit numbers (almost always 2FA/OTP codes, zip codes, or years like 2026)
  if (/^\d+$/.test(code)) return null;
  return code;
}

function extractCleanMerchant(fromHeader: string): {
  merchantName: string;
  merchantDomain: string | null;
} {
  // Parse "Display Name <user@subdomain.brand.com>"
  const angleMatch = fromHeader.match(/^"?([^"<]*)"?\s*<([^>]+)>/);
  let rawDisplay = angleMatch ? angleMatch[1].trim() : '';
  const emailAddr = (angleMatch ? angleMatch[2] : fromHeader).trim().toLowerCase();

  let merchantDomain: string | null = null;
  let domainBrandFallback = 'Merchant';

  if (emailAddr.includes('@')) {
    const fullHost = emailAddr.split('@')[1].replace(/[^a-z0-9.-]/g, '');
    const parts = fullHost.split('.').filter(Boolean);

    if (parts.length >= 2) {
      const tld = parts[parts.length - 1];
      const sld = parts[parts.length - 2];
      // Handle country-code SLDs like .co.uk or .com.au
      if ((sld === 'co' || sld === 'com') && parts.length >= 3) {
        const brandPart = parts[parts.length - 3];
        merchantDomain = `${brandPart}.${sld}.${tld}`;
        domainBrandFallback = brandPart;
      } else {
        // Strip leading ESP subdomains (e.g. e.nike.com -> nike.com, mail.sephora.com -> sephora.com)
        const significantParts = parts.filter((p, idx) =>
          idx >= parts.length - 2 ? true : !ESP_OR_GENERIC_SUBDOMAINS.has(p)
        );
        const rootParts = significantParts.slice(-2);
        merchantDomain = rootParts.join('.');
        domainBrandFallback = rootParts[0];
      }
    }
  }

  // Clean up the display name
  let cleanName = rawDisplay
    .replace(/["']/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(
      /\b(official\s+store|official|online\s+store|newsletter|promotions|rewards|customer\s+service|no-?reply|team|inc\.?|llc\.?|usa|us)\b/gi,
      ''
    )
    .replace(/\s+[|•-]\s+.*$/, '') // Strip trailing tagline after pipe/bullet/dash in sender name
    .replace(/\s+/g, ' ')
    .trim();

  if (
    !cleanName ||
    cleanName.includes('@') ||
    cleanName.length < 2 ||
    ESP_OR_GENERIC_SUBDOMAINS.has(cleanName.toLowerCase())
  ) {
    cleanName =
      domainBrandFallback.charAt(0).toUpperCase() + domainBrandFallback.slice(1);
  }

  return {
    merchantName: cleanName,
    merchantDomain,
  };
}

function extractExpirationDate(text: string, receivedAt: Date): string | null {
  const nowMs = receivedAt.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  // 1. Relative urgency patterns: "ends tonight", "expires today", "last day"
  if (/\b(ends\s+tonight|expires\s+tonight|expires\s+today|ends\s+today|final\s+hours|last\s+day)\b/i.test(text)) {
    const endOfDay = new Date(nowMs + dayMs);
    return endOfDay.toISOString();
  }

  if (/\b(ends\s+tomorrow|expires\s+tomorrow|24\s+hours\s+only|48-hour|48\s+hours)\b/i.test(text)) {
    return new Date(nowMs + 2 * dayMs).toISOString();
  }

  const inDaysMatch = text.match(/\b(?:expires|ends|valid\s+for)\s+(?:in\s+)?(\d{1,2})\s+days\b/i);
  if (inDaysMatch) {
    const days = Number(inDaysMatch[1]);
    if (days >= 1 && days <= 60) {
      return new Date(nowMs + days * dayMs).toISOString();
    }
  }

  // 2. Explicit numeric date: "expires 11/30", "valid through 12/05/2026", "ends 11/25"
  const numericDateMatch = text.match(
    /\b(?:expires|exp\.?|valid\s+(?:through|thru|until)|ends(?:\s+on)?|through|thru|until)\s*:?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i
  );
  if (numericDateMatch) {
    const month = Number(numericDateMatch[1]) - 1;
    const day = Number(numericDateMatch[2]);
    let year = numericDateMatch[3]
      ? Number(numericDateMatch[3])
      : receivedAt.getFullYear();
    if (year < 100) year += 2000;

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const candidate = new Date(year, month, day, 23, 59, 59);
      // If month wrapped into next year (e.g. December email expiring in January)
      if (candidate.getTime() < nowMs - 30 * dayMs && !numericDateMatch[3]) {
        candidate.setFullYear(year + 1);
      }
      return candidate.toISOString();
    }
  }

  // 3. Explicit Month Name date: "expires November 30", "valid through Dec 15"
  const monthNames =
    '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const namedDateRegex = new RegExp(
    `\\b(?:expires|valid\\s+(?:through|thru|until)|ends(?:\\s+on)?|through|thru|until)\\s+${monthNames}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`,
    'i'
  );
  const namedMatch = text.match(namedDateRegex);
  if (namedMatch) {
    const monthStr = namedMatch[1].slice(0, 3).toLowerCase();
    const monthIndex = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ].indexOf(monthStr);
    const day = Number(namedMatch[2]);
    const year = namedMatch[3] ? Number(namedMatch[3]) : receivedAt.getFullYear();

    if (monthIndex !== -1 && day >= 1 && day <= 31) {
      const candidate = new Date(year, monthIndex, day, 23, 59, 59);
      return candidate.toISOString();
    }
  }

  return null;
}

function cleanDescription(snippet: string, subject: string): string {
  const cleaned = snippet
    .replace(/[\u200B-\u200D\uFEFF\u034F\u00AD]+/g, '') // Strip invisible zero-width email preheader padding chars
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.toLowerCase() === subject.toLowerCase()) {
    return 'Promotional offer extracted from your inbox.';
  }
  return cleaned;
}

function guessCategory(text: string): OfferCategory {
  const lower = text.toLowerCase();
  if (
    /(shirt|shoe|apparel|wear|nike|adidas|levi|zara|fashion|clothing|dress|gap|old navy|uniqlo|j\.?crew|lululemon|nordstrom|macy|athletic|denim|jacket|boot|sneaker)/.test(
      lower
    )
  )
    return 'Fashion';
  if (
    /(uber\s*eats|doordash|pizza|coffee|restaurant|food|dining|grubhub|starbucks|chipotle|postmates|instacart|domino|panera|sweetgreen|meal|grocery|bakery|cafe|kitchen\s+delivery)/.test(
      lower
    )
  )
    return 'Food & Dining';
  if (
    /(laptop|tech|software|apple|best\s*buy|samsung|headphones|cloud|ai|gaming|dell|lenovo|logitech|sony|bose|microsoft|google\s+store|anker|gadget|monitor|phone)/.test(
      lower
    )
  )
    return 'Tech';
  if (
    /(flight|hotel|airbnb|airline|travel|marriott|expedia|car\s+rental|delta|united|southwest|hilton|hyatt|booking\.com|kayak|cruise|vacation|resort|getaway|avis|hertz|uber|lyft)/.test(
      lower
    )
  )
    return 'Travel';
  if (
    /(sephora|ulta|skincare|makeup|beauty|cosmetics|fragrance|glossier|fenty|dermstore|lotion|serum|haircare|salon|spa)/.test(
      lower
    )
  )
    return 'Beauty';
  if (
    /(furniture|home|ikea|wayfair|kitchen|decor|mattress|bed|target|walmart|costco|crate\s*&\s*barrel|pottery\s+barn|west\s+elm|lowes|home\s+depot|appliance|rug|sofa|patio)/.test(
      lower
    )
  )
    return 'Home';
  if (
    /(movie|streaming|netflix|spotify|concert|ticket|game|hulu|disney|max|peacock|fandango|ticketmaster|stubhub|audible|kindle|playstation|xbox|nintendo)/.test(
      lower
    )
  )
    return 'Entertainment';
  return 'Other';
}
