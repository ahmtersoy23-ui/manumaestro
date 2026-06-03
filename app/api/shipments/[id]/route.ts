/**
 * Shipment Detail API
 * GET: Shipment detail with items
 * PATCH: Update shipment (status, dates)
 * POST: Add items to shipment / Dispatch (send)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShipmentView, requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { getShipmentRole, canDoAction, ShipmentAction } from '@/lib/auth/shipmentPermission';
import { FBA_DESTINATION_TO_MARKETPLACE } from '@/lib/marketplaceRegions';
import { logAction } from '@/lib/auditLog';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

// --- GET: Detail ---
export const GET = withRoute<{ id: string }>({ skipAuth: true, rateLimit: 'read', fallbackMessage: 'Sevkiyat yüklenemedi' }, async ({ request, params }) => {
  const authResult = await requireShipmentView(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = params;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
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
      `SELECT product_sku as iwasku, name, category FROM products WHERE product_sku IN (${placeholders})`,
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
    const skuMasterFnsku = cc ? fnskuMap.get(`${item.iwasku}|${cc}`) ?? null : null;
    // ShipmentItem.fnsku (manuel giris) oncelikli, sonra sku_master lookup
    const fnsku = item.fnsku || skuMasterFnsku;
    return {
      ...item,
      marketplace: mkt,
      productName: pr?.productName ?? fallback?.name ?? '',
      productCategory: pr?.productCategory ?? fallback?.category ?? '',
      fnsku,
    };
  });

  // Kullanicinin bu sevkiyat icin izinlerini hesapla
  const userRole = await getShipmentRole(authResult.user.id, authResult.user.role, shipment.destinationTab);
  const actions: ShipmentAction[] = ['view', 'createShipment', 'routeItems', 'deleteItems', 'setDestination', 'manageBoxes', 'packItems', 'sendItems', 'unsendItems', 'closeShipment'];
  const permissions = Object.fromEntries(actions.map(a => [a, canDoAction(userRole, a)]));

  return successResponse({ ...shipment, items: enrichedItems }, { permissions });
});

// --- PATCH: Update status/dates ---
const UpdateShipmentSchema = z.object({
  status: z.enum(['PLANNING', 'LOADING', 'IN_TRANSIT', 'DELIVERED']).optional(),
  plannedDate: z.string().datetime().optional(),
  actualDate: z.string().datetime().optional(),
  etaDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

export const PATCH = withRoute<{ id: string }>({ skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sevkiyat güncellenemedi' }, async ({ request, params }) => {
  const { id } = params;
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

  // If dispatching (IN_TRANSIT), process reserve shipping (depo çıkışı ayrı onay modalından)
  if (data.status === 'IN_TRANSIT' && shipment.status !== 'IN_TRANSIT') {
    await prisma.$transaction(async (tx) => {
      for (const item of shipment.items) {
        if (item.reserveId) {
          await tx.stockReserve.update({
            where: { id: item.reserveId },
            data: {
              shippedQuantity: { increment: item.quantity },
              status: 'SHIPPED',
            },
          });
        }
      }
    });
  }

  // DELIVERED'a geçiş: WMS varış hook'u — koli'ler ShipmentBox.destination'a göre
  // hedef deponun POOL rafına SEALED olarak yansır (US+SHOWROOM→SHOWROOM, US+FBA/DEPO→NJ).
  // Idempotent: aynı sevkiyat ikinci kez DELIVERED yapılırsa atlar.
  let arrivalSummary: import('@/lib/wms/shipmentArrivalHook').ArrivalResult | null = null;
  if (data.status === 'DELIVERED' && shipment.status !== 'DELIVERED') {
    arrivalSummary = await prisma.$transaction(async (tx) => {
      const { processShipmentArrival } = await import('@/lib/wms/shipmentArrivalHook');
      return processShipmentArrival(tx, id, user.id);
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
    metadata: arrivalSummary ? { arrival: arrivalSummary } : undefined,
  });

  return successResponse(updated, { arrival: arrivalSummary });
});

// --- POST: Add items to shipment ---
const AddItemSchema = z.object({
  items: z.array(z.object({
    iwasku: z.string().min(1).max(50),
    quantity: z.number().int().positive(),
    desi: z.number().optional(),
    marketplaceId: z.string().max(50).optional(),
    reserveId: z.string().max(50).optional(),
    productionRequestId: z.string().max(50).optional(),
    recommendedDestination: z.string().max(10).optional(),
  })).min(1).max(500),
});

export const POST = withRoute<{ id: string }>({ skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sevkiyata ürün eklenemedi' }, async ({ request, params }) => {
  const { id } = params;
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

  // Birim desi: products.manual_size (öncelikli) → products.size
  const iwaskus = [...new Set(validation.data.items.map(i => i.iwasku))];
  const sizeMap = new Map<string, number>();
  if (iwaskus.length > 0) {
    const placeholders = iwaskus.map((_, i) => `$${i + 1}`).join(',');
    const rows = await queryProductDb(
      `SELECT p.product_sku AS iwasku, COALESCE(p.manual_size, p.size) AS unit_size
       FROM products p
       WHERE p.product_sku IN (${placeholders}) AND COALESCE(p.manual_size, p.size) IS NOT NULL`,
      iwaskus
    );
    for (const row of rows) {
      sizeMap.set(row.iwasku, parseFloat(row.unit_size));
    }
  }

  // Havuzdan eklenen FBA item'ları marketplace'siz gelir → recommendedDestination'dan
  // Amazon pazaryeri türet (US_FBA→AMZN_US...). Kolonda "Amazon US" + FNSKU lookup çalışsın.
  const fbaCodes = [...new Set(
    validation.data.items
      .filter(it => !it.marketplaceId && it.recommendedDestination && FBA_DESTINATION_TO_MARKETPLACE[it.recommendedDestination])
      .map(it => FBA_DESTINATION_TO_MARKETPLACE[it.recommendedDestination!])
  )];
  const codeToMktId = new Map<string, string>();
  if (fbaCodes.length > 0) {
    const mkts = await prisma.marketplace.findMany({
      where: { code: { in: fbaCodes } },
      select: { id: true, code: true },
    });
    for (const m of mkts) codeToMktId.set(m.code, m.id);
  }

  const created = await prisma.shipmentItem.createMany({
    data: validation.data.items.map(item => {
      const unitDesi = sizeMap.get(item.iwasku);
      const fbaMktId = item.recommendedDestination
        ? codeToMktId.get(FBA_DESTINATION_TO_MARKETPLACE[item.recommendedDestination] ?? '')
        : undefined;
      return {
        shipmentId: id,
        iwasku: item.iwasku,
        quantity: item.quantity,
        marketplaceId: item.marketplaceId ?? fbaMktId,
        reserveId: item.reserveId,
        productionRequestId: item.productionRequestId,
        recommendedDestination: item.recommendedDestination,
        desi: item.desi ?? (unitDesi ? Math.round(unitDesi * 100) / 100 : undefined),
      };
    }),
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'Shipment', entityId: id,
    description: `Sevkiyata ${created.count} ürün eklendi: ${shipment.name}`,
  });

  return successResponse({ added: created.count });
});

// --- DELETE: Sevkiyatı sil (super-admin only, sadece PLANNING/LOADING) ---
// ShipmentItem + ShipmentBox cascade silinir. ProductionRequest silinmez —
// routedShipment NULL olur ve baska sevkiyata yonlendirilebilir hale gelir.
export const DELETE = withRoute<{ id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sevkiyat silinemedi' },
  async ({ request, params }) => {
    const auth = await requireSuperAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const { id } = params;
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, destinationTab: true, _count: { select: { items: true, boxes: true } } },
    });
    if (!shipment) {
      return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });
    }

    if (shipment.status !== 'PLANNING' && shipment.status !== 'LOADING') {
      return NextResponse.json(
        { success: false, error: `Sadece PLANNING veya LOADING durumundaki sevkiyatlar silinebilir (mevcut: ${shipment.status})` },
        { status: 400 }
      );
    }

    // ShipmentItem + ShipmentBox cascade ile silinir (schema.prisma: onDelete: Cascade)
    await prisma.shipment.delete({ where: { id } });

    await logAction({
      userId: user.id, userName: user.name, userEmail: user.email,
      action: 'UPDATE_REQUEST', entityType: 'Shipment', entityId: id,
      description: `Sevkiyat silindi: ${shipment.name} (${shipment.destinationTab}) — ${shipment._count.items} item, ${shipment._count.boxes} koli`,
      metadata: { shipmentName: shipment.name, status: shipment.status, itemCount: shipment._count.items, boxCount: shipment._count.boxes },
    });

    return successResponse({ deleted: true, shipmentName: shipment.name });
  }
);
