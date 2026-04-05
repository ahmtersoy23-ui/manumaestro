/**
 * Shipment Detail API
 * GET: Shipment detail with items
 * PATCH: Update shipment (status, dates)
 * POST: Add items to shipment / Dispatch (send)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShipmentView, requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

// --- GET: Detail ---
export async function GET(request: NextRequest, { params }: Params) {
  const authResult = await requireShipmentView(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { iwasku: 'asc' },
        include: {
          shipment: false,
        },
      },
    },
  });

  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });
  }

  // Marketplace bilgilerini çöz
  const mktIds = [...new Set(shipment.items.map(i => i.marketplaceId).filter(Boolean))] as string[];
  const marketplaces = mktIds.length > 0
    ? await prisma.marketplace.findMany({
        where: { id: { in: mktIds } },
        select: { id: true, name: true, code: true },
      })
    : [];
  const mktMap = new Map(marketplaces.map(m => [m.id, m]));

  // Ürün adı/kategori: ProductionRequest'ten veya pricelab_db'den
  const prIds = shipment.items.map(i => i.productionRequestId).filter(Boolean) as string[];
  const prodReqs = prIds.length > 0
    ? await prisma.productionRequest.findMany({
        where: { id: { in: prIds } },
        select: { id: true, productName: true, productCategory: true },
      })
    : [];
  const prMap = new Map(prodReqs.map(p => [p.id, p]));

  // ProductionRequest'i olmayan item'lar için pricelab_db fallback
  const missingNameIwaskus = shipment.items
    .filter(i => !i.productionRequestId || !prMap.has(i.productionRequestId))
    .map(i => i.iwasku);
  const uniqueMissing = [...new Set(missingNameIwaskus)];

  const productMap = new Map<string, { name: string; category: string }>();
  if (uniqueMissing.length > 0) {
    const placeholders = uniqueMissing.map((_, i) => `$${i + 1}`).join(',');
    const rows = await queryProductDb(
      `SELECT DISTINCT ON (iwasku) iwasku, title AS name, product_group AS category FROM sku_master WHERE iwasku IN (${placeholders})`,
      uniqueMissing
    );
    for (const row of rows) {
      productMap.set(row.iwasku, { name: row.name ?? '', category: row.category ?? '' });
    }
  }

  // FNSKU lookup: iwasku + marketplace code → country_code → sku_master.fnsku
  const mktCodeToCountry: Record<string, string> = {
    AMZN_US: 'US', AMZN_CA: 'CA', AMZN_UK: 'UK', AMZN_AU: 'AU', AMZN_EU: 'FR',
  };
  const fnskuMap = new Map<string, string>(); // key: "iwasku|countryCode"
  const fnskuLookups: Array<{ iwasku: string; countryCode: string }> = [];
  for (const item of shipment.items) {
    const mkt = item.marketplaceId ? mktMap.get(item.marketplaceId) : null;
    const cc = mkt ? mktCodeToCountry[mkt.code] : null;
    if (cc && item.iwasku) fnskuLookups.push({ iwasku: item.iwasku, countryCode: cc });
  }
  if (fnskuLookups.length > 0) {
    const uniquePairs = [...new Map(fnskuLookups.map(l => [`${l.iwasku}|${l.countryCode}`, l])).values()];
    // Batch query: OR conditions
    const conditions = uniquePairs.map((_, i) => `(iwasku = $${i * 2 + 1} AND country_code = $${i * 2 + 2})`).join(' OR ');
    const params = uniquePairs.flatMap(p => [p.iwasku, p.countryCode]);
    const rows = await queryProductDb(
      `SELECT DISTINCT ON (iwasku, country_code) iwasku, country_code, fnsku FROM sku_master WHERE (${conditions}) AND fnsku IS NOT NULL AND fnsku != ''`,
      params
    );
    for (const row of rows) {
      fnskuMap.set(`${row.iwasku}|${row.country_code}`, row.fnsku);
    }
  }

  const enrichedItems = shipment.items.map(item => {
    const pr = item.productionRequestId ? prMap.get(item.productionRequestId) : null;
    const fallback = productMap.get(item.iwasku);
    const mkt = item.marketplaceId ? mktMap.get(item.marketplaceId) ?? null : null;
    const cc = mkt ? mktCodeToCountry[mkt.code] : null;
    const fnsku = cc ? fnskuMap.get(`${item.iwasku}|${cc}`) ?? null : null;
    return {
      ...item,
      marketplace: mkt,
      productName: pr?.productName ?? fallback?.name ?? '',
      productCategory: pr?.productCategory ?? fallback?.category ?? '',
      fnsku,
    };
  });

  return NextResponse.json({
    success: true,
    data: { ...shipment, items: enrichedItems },
  });
}

// --- PATCH: Update status/dates ---
const UpdateShipmentSchema = z.object({
  status: z.enum(['PLANNING', 'LOADING', 'IN_TRANSIT', 'DELIVERED']).optional(),
  plannedDate: z.string().datetime().optional(),
  actualDate: z.string().datetime().optional(),
  etaDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  // Shipment'in destinasyonunu bul
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'createShipment');
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const body = await request.json();
  const validation = UpdateShipmentSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const data = validation.data;
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });
  }

  // If dispatching (IN_TRANSIT), process warehouse cikis + reserve shipping
  if (data.status === 'IN_TRANSIT' && shipment.status !== 'IN_TRANSIT') {
    await prisma.$transaction(async (tx) => {
      for (const item of shipment.items) {
        // Update warehouse cikis
        await tx.warehouseProduct.updateMany({
          where: { iwasku: item.iwasku },
          data: { cikis: { increment: item.quantity } },
        });

        // Update reserve shippedQuantity if linked
        if (item.reserveId) {
          await tx.stockReserve.update({
            where: { id: item.reserveId },
            data: {
              shippedQuantity: { increment: item.quantity },
              status: 'SHIPPED', // Will be checked if fully shipped
            },
          });
        }
      }
    });
  }

  const updated = await prisma.shipment.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.plannedDate ? { plannedDate: new Date(data.plannedDate) } : {}),
      ...(data.actualDate ? { actualDate: new Date(data.actualDate) } : {}),
      ...(data.etaDate ? { etaDate: new Date(data.etaDate) } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'Shipment', entityId: id,
    description: `Sevkiyat güncellendi: ${updated.name} → ${data.status ?? 'bilgi güncellemesi'}`,
  });

  return NextResponse.json({ success: true, data: updated });
}

// --- POST: Add items to shipment ---
const AddItemSchema = z.object({
  items: z.array(z.object({
    iwasku: z.string(),
    quantity: z.number().int().positive(),
    desi: z.number().optional(),
    marketplaceId: z.string().optional(),
    reserveId: z.string().optional(),
  })).min(1),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const shipment = await prisma.shipment.findUnique({ where: { id } });
  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  }
  const authResult = await requireShipmentAction(request, shipment.destinationTab, 'routeItems');
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  if (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED') {
    return NextResponse.json({ success: false, error: 'Gönderilmiş sevkiyata ürün eklenemez' }, { status: 400 });
  }

  const body = await request.json();
  const validation = AddItemSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const created = await prisma.shipmentItem.createMany({
    data: validation.data.items.map(item => ({
      shipmentId: id,
      ...item,
    })),
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'Shipment', entityId: id,
    description: `Sevkiyata ${created.count} ürün eklendi: ${shipment.name}`,
  });

  return NextResponse.json({ success: true, data: { added: created.count } });
}
