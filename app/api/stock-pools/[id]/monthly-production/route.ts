/**
 * Monthly Production Tracking API
 * GET: Havuzun ay bazlı planlama/gerçekleşme özeti
 *
 * Veri kaynağı:
 *   Plan     → MonthlyAllocation (bu havuzun onaylı dağılımı)
 *   Üretim   → ProductionRequest (marketplaceId=SEZON, notes contains [pool:<id>])
 *              producedQuantity waterfallComplete tarafından MonthSnapshot'ten senkronize edilir.
 *
 * Ay sayfasındaki "Sezon" marketplace özetiyle tutarlıdır: aynı ProductionRequest kümesi.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin', 'editor']);
  if (authResult instanceof NextResponse) return authResult;
  const { id } = await params;

  const pool = await prisma.stockPool.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!pool) {
    return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
  }

  // Plan (MonthlyAllocation): havuzun onaylı dağılımı
  const allocations = await prisma.monthlyAllocation.findMany({
    where: { reserve: { poolId: id, status: { not: 'CANCELLED' } } },
    select: {
      month: true,
      plannedQty: true,
      plannedDesi: true,
      reserve: { select: { iwasku: true, desiPerUnit: true } },
    },
  });

  // Üretim (Sezon ProductionRequest'ler, bu havuza ait olanlar)
  const sezonMp = await prisma.marketplace.findUnique({ where: { code: 'SEZON' } });
  const sezonRequests = sezonMp
    ? await prisma.productionRequest.findMany({
        where: {
          marketplaceId: sezonMp.id,
          notes: { contains: `[pool:${id}]` },
        },
        select: {
          iwasku: true,
          productionMonth: true,
          producedQuantity: true,
          productSize: true,
        },
      })
    : [];

  // Ay bazında agregasyon
  type MonthAgg = {
    totalPlanned: number;
    totalPlannedDesi: number;
    totalProduced: number;
    totalProducedDesi: number;
    iwaskusProducing: Set<string>;
    iwaskusPlanned: Set<string>;
  };
  const byMonth = new Map<string, MonthAgg>();
  const getMonth = (month: string): MonthAgg => {
    let m = byMonth.get(month);
    if (!m) {
      m = {
        totalPlanned: 0,
        totalPlannedDesi: 0,
        totalProduced: 0,
        totalProducedDesi: 0,
        iwaskusProducing: new Set(),
        iwaskusPlanned: new Set(),
      };
      byMonth.set(month, m);
    }
    return m;
  };

  for (const a of allocations) {
    const m = getMonth(a.month);
    m.totalPlanned += a.plannedQty;
    m.totalPlannedDesi += a.plannedDesi ?? (a.reserve.desiPerUnit ? a.plannedQty * a.reserve.desiPerUnit : 0);
    m.iwaskusPlanned.add(a.reserve.iwasku);
  }

  for (const r of sezonRequests) {
    if ((r.producedQuantity ?? 0) <= 0) continue;
    const m = getMonth(r.productionMonth);
    m.totalProduced += r.producedQuantity ?? 0;
    m.totalProducedDesi += (r.productSize ?? 0) * (r.producedQuantity ?? 0);
    m.iwaskusProducing.add(r.iwasku);
  }

  const sortedMonths = [...byMonth.keys()].sort();
  const months = sortedMonths.map(month => {
    const m = byMonth.get(month)!;
    return {
      month,
      totalPlanned: m.totalPlanned,
      totalPlannedDesi: Math.round(m.totalPlannedDesi),
      totalProduced: m.totalProduced,
      totalProducedDesi: Math.round(m.totalProducedDesi),
      diff: m.totalProduced - m.totalPlanned,
      diffDesi: Math.round(m.totalProducedDesi - m.totalPlannedDesi),
      productCount: m.iwaskusProducing.size,
    };
  });

  // Per-ürün detay: her iwasku için plan ve üretim
  const byProduct = sortedMonths.map(month => {
    const planByIwasku = new Map<string, { qty: number; desi: number }>();
    for (const a of allocations) {
      if (a.month !== month) continue;
      const cur = planByIwasku.get(a.reserve.iwasku) ?? { qty: 0, desi: 0 };
      cur.qty += a.plannedQty;
      cur.desi += a.plannedDesi ?? (a.reserve.desiPerUnit ? a.plannedQty * a.reserve.desiPerUnit : 0);
      planByIwasku.set(a.reserve.iwasku, cur);
    }
    const prodByIwasku = new Map<string, { qty: number; desi: number }>();
    for (const r of sezonRequests) {
      if (r.productionMonth !== month) continue;
      const cur = prodByIwasku.get(r.iwasku) ?? { qty: 0, desi: 0 };
      cur.qty += r.producedQuantity ?? 0;
      cur.desi += (r.productSize ?? 0) * (r.producedQuantity ?? 0);
      prodByIwasku.set(r.iwasku, cur);
    }
    const productKeys = new Set([...planByIwasku.keys(), ...prodByIwasku.keys()]);
    const products = [...productKeys]
      .map(iwasku => ({
        iwasku,
        planned: planByIwasku.get(iwasku)?.qty ?? 0,
        plannedDesi: Math.round(planByIwasku.get(iwasku)?.desi ?? 0),
        produced: prodByIwasku.get(iwasku)?.qty ?? 0,
        producedDesi: Math.round(prodByIwasku.get(iwasku)?.desi ?? 0),
      }))
      .sort((a, b) => b.planned - a.planned);
    return { month, products };
  });

  return NextResponse.json({
    success: true,
    data: { months, byProduct },
  });
}
