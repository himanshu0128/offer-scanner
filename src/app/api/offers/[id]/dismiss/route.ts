import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromRequest } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const offerId = params.id;
    const offer = await prisma.offer.findFirst({
      where: {
        id: offerId,
        emailAccount: {
          userId: session.userId,
        },
      },
    });

    if (!offer) {
      return NextResponse.json({ error: 'Offer not found or unauthorized' }, { status: 404 });
    }

    const updated = await prisma.offer.update({
      where: { id: offerId },
      data: { isDismissed: true },
    });

    return NextResponse.json({ success: true, offer: updated });
  } catch (error: any) {
    console.error('Error dismissing offer:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss offer', details: error?.message },
      { status: 500 }
    );
  }
}
