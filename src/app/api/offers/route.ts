import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const codeOnly = searchParams.get('codeOnly') === 'true';
    const emailAccountId = searchParams.get('emailAccountId');
    const expiration = searchParams.get('expiration'); // 'all' | 'active' | 'expiring_soon' | 'no_expiry'
    const search = searchParams.get('search')?.trim();

    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const whereClause: any = {
      isDismissed: false,
    };

    if (category && category !== 'All') {
      whereClause.category = category;
    }

    if (codeOnly) {
      whereClause.promoCode = {
        not: null,
      };
    }

    if (emailAccountId && emailAccountId !== 'all') {
      whereClause.emailAccountId = emailAccountId;
    }

    if (expiration === 'active') {
      whereClause.OR = [
        { expiresAt: null },
        { expiresAt: { gte: now } },
      ];
    } else if (expiration === 'expiring_soon') {
      whereClause.expiresAt = {
        gte: now,
        lte: sevenDaysFromNow,
      };
    } else if (expiration === 'no_expiry') {
      whereClause.expiresAt = null;
    }

    if (search) {
      whereClause.AND = [
        ...(whereClause.AND || []),
        {
          OR: [
            { merchantName: { contains: search, mode: 'insensitive' } },
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { promoCode: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const offers = await prisma.offer.findMany({
      where: whereClause,
      include: {
        emailAccount: {
          select: {
            id: true,
            email: true,
            provider: true,
          },
        },
      },
      orderBy: [
        { merchantName: 'asc' },
        { receivedAt: 'desc' },
      ],
    });

    return NextResponse.json({ offers });
  } catch (error: any) {
    console.error('Error fetching offers:', error);
    return NextResponse.json(
      { error: 'Failed to load offers', details: error?.message },
      { status: 500 }
    );
  }
}
