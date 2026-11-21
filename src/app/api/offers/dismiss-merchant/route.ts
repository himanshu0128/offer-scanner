import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromRequest } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { merchantName, offerIds } = body as {
      merchantName?: string;
      offerIds?: string[];
    };

    if (merchantName) {
      const updated = await prisma.offer.updateMany({
        where: {
          merchantName: {
            equals: merchantName,
            mode: 'insensitive',
          },
          isDismissed: false,
          emailAccount: {
            userId: session.userId,
          },
        },
        data: { isDismissed: true },
      });

      return NextResponse.json({
        success: true,
        dismissedCount: updated.count,
        message: `Dismissed all ${updated.count} offer(s) from ${merchantName}.`,
      });
    }

    if (Array.isArray(offerIds) && offerIds.length > 0) {
      const updated = await prisma.offer.updateMany({
        where: {
          id: { in: offerIds },
          emailAccount: {
            userId: session.userId,
          },
        },
        data: { isDismissed: true },
      });

      return NextResponse.json({
        success: true,
        dismissedCount: updated.count,
      });
    }

    return NextResponse.json(
      { error: 'Provide either merchantName or offerIds to dismiss' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Error bulk-dismissing offers:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss offers', details: error?.message },
      { status: 500 }
    );
  }
}
