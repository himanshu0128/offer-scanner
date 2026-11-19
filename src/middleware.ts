import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory sliding-window rate limiter per IP for mutation endpoints
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_MUTATION_REQUESTS_PER_MIN = 30;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Apply CSRF Origin check and Rate Limiting on API state-changing requests (POST / DELETE)
  if (pathname.startsWith('/api/') && (req.method === 'POST' || req.method === 'DELETE')) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');

    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json(
            { error: 'CSRF check failed: cross-origin mutation denied' },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json({ error: 'Invalid Origin header' }, { status: 403 });
      }
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now - record.windowStart > WINDOW_MS) {
      rateLimitMap.set(ip, { count: 1, windowStart: now });
    } else {
      record.count += 1;
      if (record.count > MAX_MUTATION_REQUESTS_PER_MIN) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait a minute and try again.' },
          { status: 429 }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
