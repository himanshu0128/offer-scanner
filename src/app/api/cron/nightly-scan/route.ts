import { NextRequest, NextResponse } from 'next/server';
import { runOfferScan } from '@/lib/scanner';
import { timingSafeEqualStr } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * Automated Nightly Cron Endpoint (runs daily at 2:00 AM via Vercel Cron, GitHub Actions, or node-cron).
 * Scans the last 30 days of emails across all connected email accounts.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !timingSafeEqualStr(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized cron trigger' }, { status: 401 });
  }

  try {
    const summary = await runOfferScan('nightly_cron');
    return NextResponse.json({
      success: true,
      trigger: 'nightly_cron',
      window: 'last_30_days',
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Nightly cron scan failed:', error);
    return NextResponse.json(
      { error: 'Nightly scan failed', details: error?.message },
      { status: 500 }
    );
  }
}
