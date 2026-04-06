/**
 * Shipment Boxes API
 * GET: List boxes for a shipment
 * POST: Create a new box (auto box number)
 * DELETE: Remove a box (via ?boxId=xxx)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShipmentView, requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { z } from 'zod';

/** Marketplace code → sku_master country_code */
function marketplaceToCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    AMZN_US: 'US', AMZN_CA: 'CA', AMZN_UK: 'UK', AMZN_AU: 'AU',
    AMZN_EU: 'FR', // EU FNSKU genelde DE üzerinden
  };
  return map[code] ?? null;
}

type Params = { params: Promise<{ id: string }> };

/**
 * Kategori → koli numarası digit mapping
 * IWA Ahsap + IWA Tabletop → 0xxx
 * IWA Metal + CFW Metal → 1xxx
 * Shukran Cam → 2xxx
 * CFW Ahsap Harita → 3xxx
 * Mobilya → 4xxx
 * Alsat → 5xxx
 * Diger → 9xxx
 */
function getCategoryDigit(category: string | null | undefined): number {
  if (!category) return 9;
  const lower = category.toLowerCase();
  if (lower.includes('ahşap') && !lower.includes('harita')) return 0;
  if (lower.includes('tabletop')) return 0;
  if (lower.includes('metal')) return 1;
  if (lower.includes('cam')) return 2;
  if (lower.includes('harita')) return 3;
  if (lower.includes('mobilya') || lower.includes('furniture')) return 4;
  if (lower.includes('alsat') || lower.includes('resale')) return 5;
  return 9;
}

/**
 * Gemi adından prefix çıkar: "Gemi 69" → "69", "US-2026-08" → "US"
 */
function getShipmentPrefix(name: string): string {
  const match = name.match(/\d+/);
  return match ? match[0] : name.split(/[\s-]/)[0];
}

// --- GET: List boxes ---
export async function GET(request: NextRequest, { params }: Params) {
  const authResult = await requireShipmentView(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const boxes = await prisma.shipmentBox.findMany({
    where: { shipmentId: id },
    orderBy: { boxNumber: 'asc' },
  });

  return NextResponse.json({ success: true, data: boxes });
}

// --- POST: Create box ---
const CreateBoxSchema = z.object({
  shipmentItemId: z.string().uuid().optional().nullable(),
  iwasku: z.string().optional().nullable(),
  fnsku: z.string().optional().nullable(),
  productName: z.string().optional().nullable(),
  productCategory: z.string().optional().nullable(),
  marketplaceCode: z.string().optional().nullable(),
  destination: z.enum(['FBA', 'DEPO']).optional().default('DEPO'),
  quantity: z.number().int().positive().default(1),
  width: z.number().positive().optional().nullable(),
  height: z.number().positive().optional().nullable(),
  depth: z.number().positive().optional().nullable(),
  weight: z.number().positive().optional().nullable(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const shipment = await prisma.shipment.findUnique({ where: { id } });
  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  }

  const body = await request.json();
  const validation = CreateBoxSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Dogrulama hatasi', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const authResult = await requireShipmentAction(request, shipment.destinationTab, 'manageBoxes');
  if (authResult instanceof NextResponse) return authResult;

  const data = validation.data;
  const prefix = getShipmentPrefix(shipment.name);
  const categoryDigit = getCategoryDigit(data.productCategory);

  // Sıradaki box numarasını bul
  const rangeStart = `${prefix}-${categoryDigit}`;
  const existingBoxes = await prisma.shipmentBox.findMany({
    where: { shipmentId: id, boxNumber: { startsWith: rangeStart } },
    select: { boxNumber: true },
    orderBy: { boxNumber: 'desc' },
    take: 1,
  });

  let nextSeq = 1;
  if (existingBoxes.length > 0) {
    const seqPart = existingBoxes[0].boxNumber.split('-').pop() ?? '0000';
    nextSeq = parseInt(seqPart.slice(1), 10) + 1;
  }

  const boxNumber = `${prefix}-${categoryDigit}${String(nextSeq).padStart(3, '0')}`;

  // FNSKU auto-lookup
  let fnsku = data.fnsku ?? null;
  if (!fnsku && data.iwasku && data.marketplaceCode) {
    const countryCode = marketplaceToCountry(data.marketplaceCode);
    if (countryCode) {
      const rows = await queryProductDb(
        `SELECT fnsku FROM sku_master WHERE iwasku = $1 AND country_code = $2 AND fnsku IS NOT NULL AND fnsku != '' LIMIT 1`,
        [data.iwasku, countryCode]
      );
      if (rows.length > 0) fnsku = rows[0].fnsku;
    }
  }

  const box = await prisma.shipmentBox.create({
    data: {
      shipmentId: id,
      shipmentItemId: data.shipmentItemId ?? null,
      boxNumber,
      iwasku: data.iwasku ?? null,
      fnsku,
      productName: data.productName ?? null,
      productCategory: data.productCategory ?? null,
      marketplaceCode: data.marketplaceCode ?? null,
      destination: data.destination ?? 'DEPO',
      quantity: data.quantity,
      width: data.width ?? null,
      height: data.height ?? null,
      depth: data.depth ?? null,
      weight: data.weight ?? null,
    },
  });

  if (data.shipmentItemId) {
    await prisma.shipmentItem.update({
      where: { id: data.shipmentItemId },
      data: { packed: true },
    });
  }

  return NextResponse.json({ success: true, data: box }, { status: 201 });
}

// --- DELETE: Remove box ---
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'manageBoxes');
  if (authResult instanceof NextResponse) return authResult;
  const boxId = request.nextUrl.searchParams.get('boxId');
  if (!boxId) {
    return NextResponse.json({ success: false, error: 'boxId parametresi gerekli' }, { status: 400 });
  }

  const box = await prisma.shipmentBox.findFirst({
    where: { id: boxId, shipmentId: id },
  });
  if (!box) {
    return NextResponse.json({ success: false, error: 'Koli bulunamadi' }, { status: 404 });
  }

  await prisma.shipmentBox.delete({ where: { id: boxId } });

  // Eger bu item'in baska kolisi kalmadiysa, packed'i geri al
  if (box.shipmentItemId) {
    const remaining = await prisma.shipmentBox.count({
      where: { shipmentItemId: box.shipmentItemId, shipmentId: id },
    });
    if (remaining === 0) {
      await prisma.shipmentItem.update({
        where: { id: box.shipmentItemId },
        data: { packed: false },
      });
    }
  }

  return NextResponse.json({ success: true });
}

// --- PATCH: Set destination by box IDs or box numbers ---
const SetDestinationSchema = z.object({
  boxIds: z.array(z.string().uuid()).optional(),
  boxNumbers: z.array(z.string()).optional(), // Koli no listesi ile toplu islem
  destination: z.enum(['FBA', 'DEPO']),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'setDestination');
  if (authResult instanceof NextResponse) return authResult;
  const body = await request.json();
  const validation = SetDestinationSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ success: false, error: 'Dogrulama hatasi' }, { status: 400 });
  }

  const { boxIds, boxNumbers, destination } = validation.data;

  if (!boxIds?.length && !boxNumbers?.length) {
    return NextResponse.json({ success: false, error: 'boxIds veya boxNumbers gerekli' }, { status: 400 });
  }

  // boxNumbers verilmişse ID'lere çevir
  let targetIds = boxIds ?? [];
  let notFound: string[] = [];

  if (boxNumbers?.length) {
    const found = await prisma.shipmentBox.findMany({
      where: { shipmentId: id, boxNumber: { in: boxNumbers } },
      select: { id: true, boxNumber: true },
    });
    const foundNumbers = new Set(found.map(b => b.boxNumber));
    notFound = boxNumbers.filter(n => !foundNumbers.has(n));
    targetIds = [...targetIds, ...found.map(b => b.id)];
  }

  const result = await prisma.shipmentBox.updateMany({
    where: { id: { in: targetIds }, shipmentId: id },
    data: { destination },
  });

  return NextResponse.json({
    success: true,
    data: { updated: result.count, destination, ...(notFound.length > 0 ? { notFound } : {}) },
  });
}

// --- PUT: Update box dimensions/weight ---
const UpdateBoxSchema = z.object({
  boxId: z.string().uuid(),
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
  depth: z.number().positive().nullable().optional(),
  weight: z.number().positive().nullable().optional(),
});

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'manageBoxes');
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const validation = UpdateBoxSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ success: false, error: 'Dogrulama hatasi', details: validation.error.flatten().fieldErrors }, { status: 400 });
  }

  const { boxId, ...data } = validation.data;
  const box = await prisma.shipmentBox.update({
    where: { id: boxId, shipmentId: id },
    data,
  });

  return NextResponse.json({ success: true, data: box });
}
