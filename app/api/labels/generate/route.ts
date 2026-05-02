/**
 * Üretim etiketi seri numarası üretici endpoint'i.
 *
 * POST /api/labels/generate
 * Body: { iwasku: string, productName: string, quantity: number }
 * Response: { success: true, data: { serials: string[], iwasku, productName } }
 *
 * Atomic counter (`product_serial_counters`) kullanır — paralel istekler birbirine
 * çakışmaz. Frontend dönen serials array'ini alıp client-side popup'ta QR olarak
 * basar (lib/labels/productLabel.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateSerials } from '@/lib/serial/generate';
import { verifyAuth } from '@/lib/auth/verify';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { errorResponse } from '@/lib/api/response';
import { createLogger } from '@/lib/logger';

const logger = createLogger('LabelGen');

const GenerateLabelsSchema = z.object({
  iwasku: z.string().min(1).max(64),
  productName: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(1000),
});

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimiters.write.check(request, 'generate-labels');
    if (!rateLimitResult.success) return rateLimitExceededResponse(rateLimitResult);

    const authResult = await verifyAuth(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const user = authResult.user;

    const body = await request.json();
    const parsed = GenerateLabelsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { iwasku, productName, quantity } = parsed.data;
    const serials = await generateSerials(iwasku, quantity);

    logger.info('Etiket serileri uretildi', {
      userId: user.id,
      userEmail: user.email,
      iwasku,
      quantity,
      firstSerial: serials[0],
      lastSerial: serials[serials.length - 1],
    });

    return NextResponse.json({
      success: true,
      data: { serials, iwasku, productName },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
