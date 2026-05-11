/**
 * Sentry kurulumunu doğrulamak için kalıcı endpoint.
 *
 * Kullanım:
 *   curl "https://manumaestro.../api/sentry-verify?token=<SENTRY_VERIFY_TOKEN>"
 *   curl "https://manumaestro.../api/sentry-verify?token=<SENTRY_VERIFY_TOKEN>&throw=1"
 *
 * `SENTRY_VERIFY_TOKEN` env yoksa endpoint 404 döner — production'da
 * abuse/quota tüketimine karşı zorunlu.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export async function GET(request: NextRequest) {
  const expected = process.env.SENTRY_VERIFY_TOKEN;
  const provided = new URL(request.url).searchParams.get('token');

  // Token tanımsız veya yanlış → 404 (endpoint'in varlığını gizle)
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const shouldThrow = new URL(request.url).searchParams.get('throw') === '1';
  if (shouldThrow) {
    throw new Error('Sentry verify: intentional server-side error');
  }

  Sentry.captureMessage('Sentry verify: server-side captureMessage', {
    level: 'info',
    tags: { route: 'sentry-verify' },
  });
  await Sentry.flush(2000);

  return NextResponse.json({
    success: true,
    info: 'Mesaj Sentry\'ye gönderildi. Issues sekmesinde görünmesi 30-60 saniye sürebilir.',
    next: 'Server-side error test için: ?throw=1 parametresi ekle.',
  });
}
