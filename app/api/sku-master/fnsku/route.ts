/**
 * FNSKU Update API
 * PUT: Save fnsku to ShipmentItem + optionally update sku_master
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { z } from 'zod';

const UpdateFnskuSchema = z.object({
  shipmentItemId: z.string().uuid(),
  iwasku: z.string().min(1),
  countryCode: z.string().min(1),
  fnsku: z.string().min(1),
});

export async function PUT(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json({ success: false, error: 'Yetkisiz erisim' }, { status: 401 });
  }

  const body = await request.json();
  const validation = UpdateFnskuSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Dogrulama hatasi', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { shipmentItemId, iwasku, countryCode, fnsku } = validation.data;

  // 1. Save to ShipmentItem (always works — our own DB)
  await prisma.shipmentItem.update({
    where: { id: shipmentItemId },
    data: { fnsku },
  });

  // 2. Try to update sku_master too (best effort — shared DB, row may not exist)
  let skuMasterUpdated = false;
  try {
    const rows = await queryProductDb(
      `UPDATE sku_master SET fnsku = $1, updated_at = NOW() WHERE iwasku = $2 AND country_code = $3 AND (fnsku IS NULL OR fnsku = '') RETURNING id`,
      [fnsku, iwasku, countryCode]
    );
    skuMasterUpdated = rows.length > 0;
  } catch {
    // sku_master update failed — not critical
  }

  return NextResponse.json({
    success: true,
    data: { fnsku, skuMasterUpdated },
  });
}
