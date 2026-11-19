import { prisma } from './prisma';
import { fetchLast30DaysPromotionalEmails, RawEmailMessage } from './gmail';
import { extractOfferFromEmail, getMerchantLogoUrl } from './extractor';
import { decryptToken, encryptToken, sanitizeExternalUrl } from './crypto';

export interface ScanSummary {
  accountsScanned: number;
  emailsProcessed: number;
  offersExtracted: number;
}

/**
 * Scans all connected email accounts (or a single specified account) for offers received in the last 30 days.
 */
export async function runOfferScan(
  triggerType: 'manual' | 'nightly_cron' = 'manual',
  specificAccountId?: string,
  userId?: string
): Promise<ScanSummary> {
  const scanLog = await prisma.scanLog.create({
    data: {
      triggerType,
      status: 'running',
    },
  });

  let accountsScanned = 0;
  let emailsProcessed = 0;
  let offersExtracted = 0;

  try {
    const whereFilter: any = {};
    if (specificAccountId) whereFilter.id = specificAccountId;
    if (userId) whereFilter.userId = userId;

    const accounts = await prisma.emailAccount.findMany({
      where: Object.keys(whereFilter).length > 0 ? whereFilter : undefined,
    });

    for (const account of accounts) {
      await prisma.emailAccount.update({
        where: { id: account.id },
        data: { status: 'scanning' },
      });

      let emails: RawEmailMessage[] = [];

      if (account.provider === 'google' && account.accessToken) {
        const plainAccessToken = decryptToken(account.accessToken);
        const plainRefreshToken = decryptToken(account.refreshToken);
        if (plainAccessToken) {
          emails = await fetchLast30DaysPromotionalEmails(
            plainAccessToken,
            plainRefreshToken,
            async (newAccessToken, expiryDate) => {
              await prisma.emailAccount.update({
                where: { id: account.id },
                data: {
                  accessToken: encryptToken(newAccessToken),
                  expiresAt: expiryDate ? Math.floor(expiryDate / 1000) : undefined,
                },
              });
            }
          );
        }
      } else if (account.provider === 'demo') {
        emails = getDemoInboxEmailsForLast30Days(account.email);
      }

      accountsScanned++;

      for (const email of emails) {
        emailsProcessed++;

        // Skip if already processed for this email account
        const existing = await prisma.offer.findUnique({
          where: {
            emailAccountId_messageId: {
              emailAccountId: account.id,
              messageId: email.messageId,
            },
          },
        });

        if (existing) continue;

        const extracted = await extractOfferFromEmail(email);
        if (!extracted || !extracted.isOffer) continue;

        const merchantLogo = getMerchantLogoUrl(
          extracted.merchantDomain,
          extracted.merchantName
        );

        await prisma.offer.create({
          data: {
            emailAccountId: account.id,
            messageId: email.messageId,
            merchantName: extracted.merchantName,
            merchantDomain: extracted.merchantDomain,
            merchantLogo,
            title: extracted.title,
            description: extracted.description,
            promoCode: extracted.promoCode,
            category: extracted.category,
            discountValue: extracted.discountValue,
            offerUrl: sanitizeExternalUrl(extracted.offerUrl),
            receivedAt: email.receivedAt,
            expiresAt: extracted.expiresAt ? new Date(extracted.expiresAt) : null,
          },
        });

        offersExtracted++;
      }

      await prisma.emailAccount.update({
        where: { id: account.id },
        data: {
          status: 'active',
          lastScanned: new Date(),
        },
      });
    }

    await prisma.scanLog.update({
      where: { id: scanLog.id },
      data: {
        accountsScanned,
        emailsProcessed,
        offersExtracted,
        status: 'completed',
        completedAt: new Date(),
      },
    });

    return { accountsScanned, emailsProcessed, offersExtracted };
  } catch (error: any) {
    await prisma.scanLog.update({
      where: { id: scanLog.id },
      data: {
        accountsScanned,
        emailsProcessed,
        offersExtracted,
        status: 'failed',
        errorMessage: error?.message || 'Unknown error',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

/**
 * Generates realistic last-30-day promotional emails for demo accounts so the app can be tested immediately.
 */
function getDemoInboxEmailsForLast30Days(emailAddress: string): RawEmailMessage[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (emailAddress.includes('work') || emailAddress.includes('alex')) {
    return [
      {
        messageId: 'demo-msg-uber-1',
        from: 'Uber Eats <offers@ubereats.com>',
        subject: 'Enjoy 40% off your next 3 delivery orders!',
        snippet: 'Hungry? Use promo code EATS40NOW at checkout before this Sunday.',
        bodyText:
          'Save 40% (up to $15) on your next 3 Uber Eats delivery orders over $25. Enter promo code EATS40NOW in the app. Offer expires in 4 days. Visit https://www.ubereats.com',
        receivedAt: new Date(now - 2 * dayMs),
      },
      {
        messageId: 'demo-msg-bestbuy-2',
        from: 'Best Buy <deals@bestbuy.com>',
        subject: 'Member Exclusive: $150 Off Select MacBook & iPad Models',
        snippet: 'Instant savings automatically applied online at BestBuy.com.',
        bodyText:
          'Upgrade your tech gear! Save $150 on select Apple MacBook Air and iPad Pro models. No promo code needed — discount applied automatically at checkout. Valid for 10 more days at https://www.bestbuy.com',
        receivedAt: new Date(now - 6 * dayMs),
      },
      {
        messageId: 'demo-msg-marriott-3',
        from: 'Marriott Bonvoy <promotions@marriott.com>',
        subject: '20% Off Weekend Stays + 2,500 Bonus Points',
        snippet: 'Book your getaway with code BONVOY20 within the next 14 days.',
        bodyText:
          'Escape this month with 20% off weekend hotel stays worldwide. Use code BONVOY20 when booking on https://www.marriott.com.',
        receivedAt: new Date(now - 11 * dayMs),
      },
      {
        messageId: 'demo-msg-spotify-4',
        from: 'Spotify <no-reply@spotify.com>',
        subject: 'Get 3 Months of Spotify Premium for $0.99',
        snippet: 'Limited time offer for returning subscribers. Claim directly via link.',
        bodyText:
          'Come back to ad-free music! Enjoy 3 months of Spotify Premium for just $0.99 total. No code needed, activate directly at https://www.spotify.com.',
        receivedAt: new Date(now - 18 * dayMs),
      },
    ];
  }

  return [
    {
      messageId: 'demo-msg-nike-1',
      from: 'Nike <nike@official.nike.com>',
      subject: 'Extra 25% Off Sale Styles + Free Shipping',
      snippet: 'Use code SPORT25 at checkout. Members get free shipping on all orders.',
      bodyText:
        'Gear up for the season. Take an extra 25% off select footwear and apparel with promo code SPORT25 at https://www.nike.com. Expires in 5 days.',
      receivedAt: new Date(now - 1 * dayMs),
    },
    {
      messageId: 'demo-msg-nike-2',
      from: 'Nike <nike@official.nike.com>',
      subject: '$20 Off Orders Over $100 — App Exclusive',
      snippet: 'Apply code JUSTDOIT20 in the Nike App before month end.',
      bodyText:
        'Spend $100 or more and save $20 immediately with code JUSTDOIT20. Shop at https://www.nike.com.',
      receivedAt: new Date(now - 9 * dayMs),
    },
    {
      messageId: 'demo-msg-sephora-3',
      from: 'Sephora <beautyinsider@sephora.com>',
      subject: 'Beauty Insider Sale: 20% Off Your Entire Purchase',
      snippet: 'Use code GLOW20 as many times as you want through Friday!',
      bodyText:
        'Stock up on skincare, makeup, and fragrance! Enter promo code GLOW20 at checkout for 20% off sitewide at https://www.sephora.com.',
      receivedAt: new Date(now - 3 * dayMs),
    },
    {
      messageId: 'demo-msg-wayfair-4',
      from: 'Wayfair <deals@wayfair.com>',
      subject: 'Up to 60% Off Living Room & Patio Furniture Flash Sale',
      snippet: 'Auto-applied flash deals — no coupon code required.',
      bodyText:
        'Refresh your space! Save up to 60% on sofas, rugs, and patio sets during our 72-hour flash sale at https://www.wayfair.com.',
      receivedAt: new Date(now - 7 * dayMs),
    },
    {
      messageId: 'demo-msg-doordash-5',
      from: 'DoorDash <no-reply@doordash.com>',
      subject: '$10 Off Your Next 2 Dinner Orders',
      snippet: 'Enter promo code DINNER10 at checkout on orders $20+.',
      bodyText:
        'Treat yourself tonight! Get $10 off your next two orders of $20 or more with code DINNER10 at https://www.doordash.com.',
      receivedAt: new Date(now - 4 * dayMs),
    },
  ];
}
