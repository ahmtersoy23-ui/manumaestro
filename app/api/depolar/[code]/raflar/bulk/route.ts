/**
 * POST /api/depolar/[code]/raflar/bulk
 * Toplu raf yaratma — codes[] alır, mevcut olanları atlar, yeni olanları yaratır.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const BulkSchema = z.object({
  codes: z.array(z.string().trim().min(1).max(50)).min(1).max(500),
  shelfType: z.enum(['POOL', 'TEMP', 'NORMAL']).default('NORMAL'),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'bulkCreateShelves');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }

  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { codes, shelfType, notes } = parsed.data;
  // Tekrar eden kodları temizle, trim
  const uniqueCodes = Array.from(new Set(codes.map((c) => c.trim()).filter((c) => c.length > 0)));

  // Mevcutları bul
  const existing = await prisma.shelf.findMany({
    where: { warehouseCode: upperCode, code: { in: uniqueCodes } },
    select: { code: true },
  });
  const existingSet = new Set(existing.map((e) => e.code));
  const newCodes = uniqueCodes.filter((c) => !existingSet.has(c));

  if (newCodes.length === 0) {
    return NextResponse.json({
      success: true,
      data: { created: 0, skipped: existingSet.size, total: uniqueCodes.length, skippedCodes: [...existingSet] },
    });
  }

  await prisma.shelf.createMany({
    data: newCodes.map((c) => ({
      warehouseCode: upperCode,
      code: c,
      shelfType,
      notes: notes ?? null,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({
    success: true,
    data: {
      created: newCodes.length,
      skipped: existingSet.size,
      total: uniqueCodes.length,
      skippedCodes: [...existingSet],
    },
  });
}
