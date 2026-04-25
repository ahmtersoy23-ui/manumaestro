/**
 * POST /api/depolar/[code]/unmatched/[id]/skip
 * Bir UnmatchedSeedRow satırını "atla/sil" olarak işaretle.
 * Body: { applyToAllSameLookup?, notes? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const SkipSchema = z.object({
  applyToAllSameLookup: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'resolveUnmatched');
  if (auth instanceof NextResponse) return auth;

  let body: unknown = {};
  try { body = await request.json(); } catch { /* boş body kabul */ }
  const parsed = SkipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { applyToAllSameLookup, notes } = parsed.data;

  const target = await prisma.unmatchedSeedRow.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ success: false, error: 'Eşleşmeyen kayıt bulunamadı' }, { status: 404 });
  }
  if (target.warehouseCode !== upperCode) {
    return NextResponse.json({ success: false, error: 'Kayıt bu depoya ait değil' }, { status: 400 });
  }

  const where = applyToAllSameLookup
    ? { warehouseCode: upperCode, rawLookup: target.rawLookup, status: 'PENDING' as const }
    : { id };

  const updated = await prisma.unmatchedSeedRow.updateMany({
    where,
    data: {
      status: 'SKIPPED',
      resolvedAt: new Date(),
      resolvedById: auth.user.id,
      resolutionType: 'SKIP',
      notes: notes ?? 'Admin atladı',
    },
  });

  return NextResponse.json({ success: true, data: { skipped: updated.count } });
}
