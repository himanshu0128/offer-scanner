import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const offerId = params.id;
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
