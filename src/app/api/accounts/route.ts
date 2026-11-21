import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { revokeGoogleToken } from '@/lib/gmail';
import { decryptToken } from '@/lib/crypto';
import { getSessionFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const accounts = await prisma.emailAccount.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        provider: true,
        lastScanned: true,
        status: true,
        _count: {
          select: {
            offers: {
              where: { isDismissed: false },
            },
          },
        },
      },
    });

    const latestScan = await prisma.scanLog.findFirst({
      orderBy: { startedAt: 'desc' },
    });

    return NextResponse.json({ accounts, latestScan });
  } catch (error: any) {
    console.error('Error loading accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch connected email accounts' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    }

    const existing = await prisma.emailAccount.findFirst({
      where: { id, userId: session.userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Account not found or unauthorized' }, { status: 404 });
    }

    if (existing.provider === 'google') {
      const refreshOrAccess =
        decryptToken(existing.refreshToken) || decryptToken(existing.accessToken);
      if (refreshOrAccess) {
        await revokeGoogleToken(refreshOrAccess);
      }
    }

    await prisma.emailAccount.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to remove account', details: error?.message },
      { status: 500 }
    );
  }
}
