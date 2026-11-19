import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getGoogleAuthUrl, revokeGoogleToken } from '@/lib/gmail';
import { runOfferScan } from '@/lib/scanner';
import { decryptToken } from '@/lib/crypto';

export async function GET() {
  try {
    const accounts = await prisma.emailAccount.findMany({
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Option 1: Start Google OAuth flow to connect a real Gmail account
    if (body.action === 'google_oauth') {
      if (
        !process.env.GOOGLE_CLIENT_ID ||
        process.env.GOOGLE_CLIENT_ID === 'your-google-client-id.apps.googleusercontent.com'
      ) {
        return NextResponse.json(
          {
            error:
              'GOOGLE_CLIENT_ID is not configured in .env yet. You can add a Demo Inbox account right now or set GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET.',
          },
          { status: 400 }
        );
      }
      const url = getGoogleAuthUrl();
      return NextResponse.json({ authUrl: url });
    }

    // Option 2: Connect a Demo / Custom Email Account for immediate testing & multi-inbox demo
    if (body.email) {
      const email = String(body.email).trim().toLowerCase();
      const account = await prisma.emailAccount.upsert({
        where: { email },
        update: { status: 'active' },
        create: {
          email,
          provider: body.provider || 'demo',
          status: 'active',
        },
      });

      // Automatically trigger an initial 30-day scan for the newly added account
      await runOfferScan('manual', account.id);

      return NextResponse.json({ account });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error: any) {
    console.error('Error adding email account:', error);
    return NextResponse.json(
      { error: 'Failed to connect email account', details: error?.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    }

    const existing = await prisma.emailAccount.findUnique({
      where: { id },
    });

    if (existing && existing.provider === 'google') {
      const refreshOrAccess =
        decryptToken(existing.refreshToken) || decryptToken(existing.accessToken);
      if (refreshOrAccess) {
        await revokeGoogleToken(refreshOrAccess);
      }
    }

    await prisma.emailAccount.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to remove account', details: error?.message },
      { status: 500 }
    );
  }
}
