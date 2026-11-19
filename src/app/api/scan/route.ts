import { NextRequest, NextResponse } from 'next/server';
import { runOfferScan } from '@/lib/scanner';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const accountId = body?.accountId || undefined;

    const summary = await runOfferScan('manual', accountId);
    return NextResponse.json({
      success: true,
      message: `Scanned ${summary.accountsScanned} account(s) (last 30 days) and found ${summary.offersExtracted} new offer(s).`,
      summary,
    });
  } catch (error: any) {
    console.error('Manual scan failed:', error);
    return NextResponse.json(
      { error: 'Failed to scan email accounts', details: error?.message },
      { status: 500 }
    );
  }
}
