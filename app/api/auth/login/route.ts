/**
 * POST /api/auth/login  — { token } body alir, SSO verify eder, HttpOnly cookie set eder.
 *
 * Bu endpoint /auth/bootstrap client-side sayfasi tarafindan cagrilir:
 * portal token'i URL fragment ile yolladigi icin server log'a dusmez,
 * client JS fragment'i okuyup buraya POST eder. Geri uyumluluk: middleware
 * hala query ?token= kabul ediyor (apps-sso eski akista oldugu surece).
 */
import { NextRequest, NextResponse } from 'next/server';
import { authRateLimiter } from '@/lib/rate-limiter';

const SSO_URL = process.env.SSO_URL || 'https://apps.iwa.web.tr';
const SSO_APP_CODE = process.env.SSO_APP_CODE || 'manumaestro';
const IS_PROD = process.env.NODE_ENV === 'production';

export async function POST(request: NextRequest) {
  const rl = authRateLimiter.check(request);
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rl.retryAfter },
      { status: 429 }
    );
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  try {
    const r = await fetch(`${SSO_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app_code: SSO_APP_CODE }),
    });
    const data = await r.json();
    if (!data?.success) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const res = NextResponse.json({ success: true, user: data.data.user, role: data.data.role });
    res.cookies.set('sso_access_token', token, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: IS_PROD ? 'strict' : 'lax',
      maxAge: 60 * 60 * 24, // 24h — middleware'deki ayarla ayni
      path: '/',
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
  }
}
