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

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateSerials } from '@/lib/serial/generate';
import { createLogger } from '@/lib/logger';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const logger = createLogger('LabelGen');

const GenerateLabelsSchema = z.object({
  iwasku: z.string().min(1).max(64),
  productName: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(1000),
});

export const POST = withRoute(
  { rateLimit: 'write', fallbackMessage: 'Etiket serileri üretilemedi' },
  async ({ request, user }) => {
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
      userId: user!.id,
      userEmail: user!.email,
      iwasku,
      quantity,
      firstSerial: serials[0],
      lastSerial: serials[serials.length - 1],
    });

    return successResponse({ serials, iwasku, productName });
  }
);
