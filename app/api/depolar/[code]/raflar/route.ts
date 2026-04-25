/**
 * GET /api/depolar/[code]/raflar — raf listesi + özet
 * POST /api/depolar/[code]/raflar — yeni raf yarat (tek)
 *
 * Query (GET):
 *   - q: raf kodu içinde arama (case-insensitive)
 *   - shelfType: POOL | TEMP | NORMAL filtresi
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { Prisma } from '@prisma/client';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const shelfTypeFilter = searchParams.get('shelfType');

  const where: Prisma.ShelfWhereInput = {
    warehouseCode: upperCode,
    isActive: true,
  };
  if (q) where.code = { contains: q, mode: 'insensitive' };
  if (shelfTypeFilter && ['POOL', 'TEMP', 'NORMAL'].includes(shelfTypeFilter)) {
    where.shelfType = shelfTypeFilter as 'POOL' | 'TEMP' | 'NORMAL';
  }

  const shelves = await prisma.shelf.findMany({
    where,
    orderBy: [{ shelfType: 'asc' }, { code: 'asc' }],
  });

  // Her raf için stock+box özetini batch al
  const shelfIds = shelves.map((s) => s.id);
  const [stockAgg, boxAgg] = await Promise.all([
    prisma.shelfStock.groupBy({
      by: ['shelfId'],
      where: { shelfId: { in: shelfIds } },
      _sum: { quantity: true, reservedQty: true },
      _count: true,
    }),
    prisma.shelfBox.groupBy({
      by: ['shelfId', 'status'],
      where: { shelfId: { in: shelfIds } },
      _sum: { quantity: true, reservedQty: true },
      _count: true,
    }),
  ]);

  const stockByShelf = new Map(stockAgg.map((s) => [s.shelfId, s]));
  const boxByShelf = new Map<string, {
    sealedCount: number; sealedQty: number;
    partialCount: number; partialQty: number;
    emptyCount: number;
  }>();
  for (const b of boxAgg) {
    const cur = boxByShelf.get(b.shelfId) ?? {
      sealedCount: 0, sealedQty: 0, partialCount: 0, partialQty: 0, emptyCount: 0,
    };
    if (b.status === 'SEALED') {
      cur.sealedCount += b._count;
      cur.sealedQty += b._sum.quantity ?? 0;
    } else if (b.status === 'PARTIAL') {
      cur.partialCount += b._count;
      cur.partialQty += b._sum.quantity ?? 0;
    } else {
      cur.emptyCount += b._count;
    }
    boxByShelf.set(b.shelfId, cur);
  }

  const result = shelves.map((s) => {
    const stock = stockByShelf.get(s.id);
    const box = boxByShelf.get(s.id) ?? {
      sealedCount: 0, sealedQty: 0, partialCount: 0, partialQty: 0, emptyCount: 0,
    };
    return {
      id: s.id,
      code: s.code,
      shelfType: s.shelfType,
      notes: s.notes,
      summary: {
        looseLines: stock?._count ?? 0,
        looseQty: stock?._sum.quantity ?? 0,
        looseReserved: stock?._sum.reservedQty ?? 0,
        sealedBoxes: box.sealedCount,
        sealedQty: box.sealedQty,
        partialBoxes: box.partialCount,
        partialQty: box.partialQty,
      },
    };
  });

  return NextResponse.json({
    success: true,
    data: { shelves: result, role: auth.shelfRole },
  });
}

const CreateShelfSchema = z.object({
  code: z.string().trim().min(1).max(50),
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

  const auth = await requireShelfAction(request, upperCode, 'createShelf');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }

  const parsed = CreateShelfSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { code: shelfCode, shelfType, notes } = parsed.data;

  // Aynı depoda aynı kod var mı?
  const existing = await prisma.shelf.findUnique({
    where: { warehouseCode_code: { warehouseCode: upperCode, code: shelfCode } },
  });
  if (existing) {
    return NextResponse.json(
      { success: false, error: `Bu depoda "${shelfCode}" raf kodu zaten var` },
      { status: 409 }
    );
  }

  const created = await prisma.shelf.create({
    data: {
      warehouseCode: upperCode,
      code: shelfCode,
      shelfType,
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
