import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding multi-account email offer scanner database...');

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // 1. Create two connected email accounts
  const personalAccount = await prisma.emailAccount.upsert({
    where: { email: 'sarah.personal@gmail.com' },
    update: { lastScanned: new Date() },
    create: {
      email: 'sarah.personal@gmail.com',
      provider: 'demo',
      status: 'active',
      lastScanned: new Date(),
    },
  });

  const shoppingAccount = await prisma.emailAccount.upsert({
    where: { email: 'alex.work@gmail.com' },
    update: { lastScanned: new Date() },
    create: {
      email: 'alex.work@gmail.com',
      provider: 'demo',
      status: 'active',
      lastScanned: new Date(),
    },
  });

  const sampleOffers = [
    {
      emailAccountId: personalAccount.id,
      messageId: 'seed-nike-1',
      merchantName: 'Nike',
      merchantDomain: 'nike.com',
      merchantLogo: 'https://www.google.com/s2/favicons?domain=nike.com&sz=128',
      title: 'Extra 25% Off Sale Styles + Free Shipping',
      description: 'Take an extra 25% off select running shoes & apparel online.',
      promoCode: 'SPORT25',
      category: 'Fashion',
      discountValue: '25% OFF',
      offerUrl: 'https://www.nike.com',
      receivedAt: new Date(now - 2 * dayMs),
      expiresAt: new Date(now + 4 * dayMs), // Expiring soon
    },
    {
      emailAccountId: personalAccount.id,
      messageId: 'seed-nike-2',
      merchantName: 'Nike',
      merchantDomain: 'nike.com',
      merchantLogo: 'https://www.google.com/s2/favicons?domain=nike.com&sz=128',
      title: '$20 Off Orders Over $100',
      description: 'App & Member exclusive reward on full-price footwear.',
      promoCode: 'JUSTDOIT20',
      category: 'Fashion',
      discountValue: '$20 OFF',
      offerUrl: 'https://www.nike.com',
      receivedAt: new Date(now - 9 * dayMs),
      expiresAt: new Date(now + 18 * dayMs),
    },
    {
      emailAccountId: personalAccount.id,
      messageId: 'seed-sephora-1',
      merchantName: 'Sephora',
      merchantDomain: 'sephora.com',
      merchantLogo: 'https://www.google.com/s2/favicons?domain=sephora.com&sz=128',
      title: 'Beauty Insider Event: 20% Off Entire Purchase',
      description: 'Valid on skincare, makeup, and hair care. Unlimited uses.',
      promoCode: 'GLOW20',
      category: 'Beauty',
      discountValue: '20% OFF',
      offerUrl: 'https://www.sephora.com',
      receivedAt: new Date(now - 3 * dayMs),
      expiresAt: new Date(now + 3 * dayMs), // Expiring soon
    },
    {
      emailAccountId: shoppingAccount.id,
      messageId: 'seed-ubereats-1',
      merchantName: 'Uber Eats',
      merchantDomain: 'ubereats.com',
      merchantLogo: 'https://www.google.com/s2/favicons?domain=ubereats.com&sz=128',
      title: '40% Off Your Next 3 Delivery Orders',
      description: 'Up to $15 maximum discount per order over $25 minimum.',
      promoCode: 'EATS40NOW',
      category: 'Food & Dining',
      discountValue: '40% OFF',
      offerUrl: 'https://www.ubereats.com',
      receivedAt: new Date(now - 1 * dayMs),
      expiresAt: new Date(now + 5 * dayMs), // Expiring soon
    },
    {
      emailAccountId: shoppingAccount.id,
      messageId: 'seed-bestbuy-1',
      merchantName: 'Best Buy',
      merchantDomain: 'bestbuy.com',
      merchantLogo: 'https://www.google.com/s2/favicons?domain=bestbuy.com&sz=128',
      title: '$150 Off Select MacBook Air & iPad Pro Models',
      description: 'Instant member savings applied automatically at checkout (no promo code required).',
      promoCode: null,
      category: 'Tech',
      discountValue: '$150 OFF',
      offerUrl: 'https://www.bestbuy.com',
      receivedAt: new Date(now - 6 * dayMs),
      expiresAt: new Date(now + 12 * dayMs),
    },
    {
      emailAccountId: personalAccount.id,
      messageId: 'seed-wayfair-1',
      merchantName: 'Wayfair',
      merchantDomain: 'wayfair.com',
      merchantLogo: 'https://www.google.com/s2/favicons?domain=wayfair.com&sz=128',
      title: 'Up to 60% Off Living Room & Outdoor Flash Sale',
      description: 'Direct link-activated deal across 5,000+ home items.',
      promoCode: null,
      category: 'Home',
      discountValue: 'UP TO 60% OFF',
      offerUrl: 'https://www.wayfair.com',
      receivedAt: new Date(now - 10 * dayMs),
      expiresAt: null,
    },
    {
      emailAccountId: shoppingAccount.id,
      messageId: 'seed-marriott-1',
      merchantName: 'Marriott Bonvoy',
      merchantDomain: 'marriott.com',
      merchantLogo: 'https://www.google.com/s2/favicons?domain=marriott.com&sz=128',
      title: '20% Off Weekend Stays + 2,500 Bonus Points',
      description: 'Valid at participating hotels worldwide when booked this month.',
      promoCode: 'BONVOY20',
      category: 'Travel',
      discountValue: '20% OFF',
      offerUrl: 'https://www.marriott.com',
      receivedAt: new Date(now - 14 * dayMs),
      expiresAt: new Date(now + 15 * dayMs),
    },
  ];

  for (const item of sampleOffers) {
    await prisma.offer.upsert({
      where: {
        emailAccountId_messageId: {
          emailAccountId: item.emailAccountId,
          messageId: item.messageId,
        },
      },
      update: item,
      create: item,
    });
  }

  await prisma.scanLog.create({
    data: {
      triggerType: 'nightly_cron',
      accountsScanned: 2,
      emailsProcessed: 42,
      offersExtracted: sampleOffers.length,
      status: 'completed',
      completedAt: new Date(),
    },
  });

  console.log('Seed completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
