/**
 * GET   /api/depolar/[code]/raflar/[shelfId]   — raf detayı
 * PATCH /api/depolar/[code]/raflar/[shelfId]   — code/isActive/notes düzenle (admin)
 * shelfId parametresi gerçekten ID olabilir veya raf kodu (URL friendly).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string; shelfId: string }> }
) {
  const { code, shelfId: shelfIdOrCode } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  // Raf kodu veya ID ile bul
  const shelf = await prisma.shelf.findFirst({
    where: {
      warehouseCode: upperCode,
      OR: [
        { id: shelfIdOrCode },
        { code: decodeURIComponent(shelfIdOrCode) },
      ],
    },
  });

  if (!shelf) {
    return NextResponse.json({ success: false, error: 'Raf bulunamadı' }, { status: 404 });
  }

  const [stocks, boxes, movements] = await Promise.all([
    prisma.shelfStock.findMany({
      where: { shelfId: shelf.id },
      orderBy: { iwasku: 'asc' },
    }),
    prisma.shelfBox.findMany({
      where: { shelfId: shelf.id },
      orderBy: [{ status: 'asc' }, { boxNumber: 'asc' }],
    }),
    prisma.shelfMovement.findMany({
      where: {
        warehouseCode: upperCode,
        OR: [{ fromShelfId: shelf.id }, { toShelfId: shelf.id }],
      },
      include: { reversedBy: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);

  // Product names lookup (toplu)
  const allIwaskus = [
    ...stocks.map((s) => s.iwasku),
    ...boxes.map((b) => b.iwasku),
  ];
  const productMap = await getProductsByIwasku(allIwaskus);

  return NextResponse.json({
    success: true,
    data: {
      shelf: {
        id: shelf.id,
        code: shelf.code,
        shelfType: shelf.shelfType,
        notes: shelf.notes,
        isActive: shelf.isActive,
        warehouseCode: shelf.warehouseCode,
      },
      role: auth.shelfRole,
      stocks: stocks.map((s) => ({
        id: s.id,
        iwasku: s.iwasku,
        productName: productMap.get(s.iwasku)?.name ?? null,
        category: productMap.get(s.iwasku)?.category ?? null,
        asin: productMap.get(s.iwasku)?.asin ?? null,
        quantity: s.quantity,
        reservedQty: s.reservedQty,
        availableQty: s.quantity - s.reservedQty,
      })),
      boxes: boxes.map((b) => ({
        id: b.id,
        boxNumber: b.boxNumber,
        iwasku: b.iwasku,
        productName: productMap.get(b.iwasku)?.name ?? null,
        category: productMap.get(b.iwasku)?.category ?? null,
        asin: productMap.get(b.iwasku)?.asin ?? null,
        fnsku: b.fnsku,
        marketplaceCode: b.marketplaceCode,
        destination: b.destination,
        quantity: b.quantity,
        reservedQty: b.reservedQty,
        availableQty: b.quantity - b.reservedQty,
        status: b.status,
        shipmentBoxId: b.shipmentBoxId,
      })),
      movements,
    },
  });
}

/* ─────────────────────────── PATCH (admin) ─────────────────────────── */

const PatchSchema = z
  .object({
    code: z.string().trim().min(1).max(50).optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((d) => d.code !== undefined || d.isActive !== undefined || d.notes !== undefined, {
    message: 'En az bir alan güncellenmeli',
  });

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string; shelfId: string }> }
) {
  const { code, shelfId: shelfIdOrCode } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  // Admin-only (manageWarehouseSettings sadece ADMIN role'ünde true)
  const auth = await requireShelfAction(request, upperCode, 'manageWarehouseSettings');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const shelf = await prisma.shelf.findFirst({
    where: {
      warehouseCode: upperCode,
      OR: [{ id: shelfIdOrCode }, { code: decodeURIComponent(shelfIdOrCode) }],
    },
  });
  if (!shelf) {
    return NextResponse.json({ success: false, error: 'Raf bulunamadı' }, { status: 404 });
  }

  const data = parsed.data;

  // Code rename: aynı depoda unique olmalı
  if (data.code && data.code !== shelf.code) {
    const dup = await prisma.shelf.findFirst({
      where: { warehouseCode: upperCode, code: data.code, NOT: { id: shelf.id } },
      select: { id: true },
    });
    if (dup) {
      return NextResponse.json(
        { success: false, error: `Bu kodda başka raf var: ${data.code}` },
        { status: 409 }
      );
    }
  }

  // Pasif yapma: rezerveli stok / koli varsa blokla
  if (data.isActive === false && shelf.isActive === true) {
    const [stockReserved, boxReserved] = await Promise.all([
      prisma.shelfStock.aggregate({
        where: { shelfId: shelf.id, reservedQty: { gt: 0 } },
        _count: true,
      }),
      prisma.shelfBox.aggregate({
        where: { shelfId: shelf.id, reservedQty: { gt: 0 } },
        _count: true,
      }),
    ]);
    if (stockReserved._count > 0 || boxReserved._count > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rafta rezerve var — pasif yapmadan önce sipariş iptal/sevk edilmeli',
        },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.shelf.update({
    where: { id: shelf.id },
    data: {
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });

  return NextResponse.json({ success: true, data: updated });
}
