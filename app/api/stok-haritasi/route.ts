/**
 * GET /api/stok-haritasi
 *
 * Tüm lokasyonlarda iwasku bazında ON-HAND stok haritası (sadece görüntüleme):
 *  - CG: Shukran (fba_inventory WFS) + MDN (WFM)  [pricelab_db]
 *  - FBA: US/UK/EU/CA/AU/AE/SA  [pricelab_db fba_inventory]
 *  - US depo: Somerset (NJ) + Fairfield (SHOWROOM)  [canlı shelf on-hand]
 *  - Ankara: ATP (getATPBulk.atp) + Sezon Stok (getATPBulk.reserved)
 *  - Ad/kategori/desi: products (pricelab_db)
 *
 * Stok-görüntüleme izni (checkStockPermission view) gerekir; admin bypass.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { checkStockPermission } from '@/lib/auth/verify';
import { getUsOnHand } from '@/lib/wms/usWarehouseStock';
import { getATPBulk } from '@/lib/db/atp';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

interface FbaRow {
  iwasku: string;
  fba_us: number; fba_uk: number; fba_eu: number; fba_ca: number;
  fba_au: number; fba_ae: number; fba_sa: number;
  shukran_cg: number; mdn_cg: number;
}
interface ProdRow { iwasku: string; name: string | null; category: string | null; desi: number | string | null }

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Stok haritası alınamadı' },
  async ({ user }) => {
    const perm = await checkStockPermission(user!.id, user!.role, 'view');
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.reason }, { status: 403 });
    }

    const ankaraIwaskus = (await prisma.warehouseProduct.findMany({ select: { iwasku: true } })).map((p) => p.iwasku);

    const [fbaRows, usOnHand, atpResults] = await Promise.all([
      queryProductDb(`
        SELECT iwasku,
          SUM(CASE WHEN warehouse='US'  THEN fulfillable_quantity ELSE 0 END)::int AS fba_us,
          SUM(CASE WHEN warehouse='UK'  THEN fulfillable_quantity ELSE 0 END)::int AS fba_uk,
          SUM(CASE WHEN warehouse='EU'  THEN fulfillable_quantity ELSE 0 END)::int AS fba_eu,
          SUM(CASE WHEN warehouse='CA'  THEN fulfillable_quantity ELSE 0 END)::int AS fba_ca,
          SUM(CASE WHEN warehouse='AU'  THEN fulfillable_quantity ELSE 0 END)::int AS fba_au,
          SUM(CASE WHEN warehouse='AE'  THEN fulfillable_quantity ELSE 0 END)::int AS fba_ae,
          SUM(CASE WHEN warehouse='SA'  THEN fulfillable_quantity ELSE 0 END)::int AS fba_sa,
          SUM(CASE WHEN warehouse='WFS' THEN fulfillable_quantity ELSE 0 END)::int AS shukran_cg,
          SUM(CASE WHEN warehouse='WFM' THEN fulfillable_quantity ELSE 0 END)::int AS mdn_cg
        FROM fba_inventory
        GROUP BY iwasku
      `) as Promise<FbaRow[]>,
      getUsOnHand(),
      getATPBulk(ankaraIwaskus),
    ]);

    const fbaMap = new Map(fbaRows.map((r) => [r.iwasku, r]));
    const atpMap = new Map(atpResults.map((a) => [a.iwasku, a]));

    const allIwaskus = new Set<string>([...fbaMap.keys(), ...usOnHand.keys(), ...atpMap.keys()]);

    // Ürün adı/kategori/desi yalnız görünen iwasku'lar için — eskiden tüm products
    // tablosu (~15k satır) çekiliyordu; artık allIwaskus'a filtreli (indexed product_sku).
    const prodRows = (allIwaskus.size > 0
      ? ((await queryProductDb(
          `SELECT product_sku AS iwasku, name, category, COALESCE(manual_size, size) AS desi
           FROM products WHERE product_sku = ANY($1::text[])`,
          [[...allIwaskus]],
        )) as ProdRow[])
      : []);
    const prodMap = new Map(prodRows.map((p) => [p.iwasku, p]));

    const rows = [];
    for (const iwasku of allIwaskus) {
      const fba = fbaMap.get(iwasku);
      const us = usOnHand.get(iwasku) ?? { NJ: 0, SHOWROOM: 0 };
      const atp = atpMap.get(iwasku);
      const prod = prodMap.get(iwasku);

      const shukranCg = fba?.shukran_cg ?? 0;
      const mdnCg = fba?.mdn_cg ?? 0;
      const fbaUs = fba?.fba_us ?? 0, fbaUk = fba?.fba_uk ?? 0, fbaEu = fba?.fba_eu ?? 0;
      const fbaCa = fba?.fba_ca ?? 0, fbaAu = fba?.fba_au ?? 0, fbaAe = fba?.fba_ae ?? 0, fbaSa = fba?.fba_sa ?? 0;
      const ankaraAtp = Math.max(0, atp?.atp ?? 0);
      const sezon = Math.max(0, atp?.reserved ?? 0);

      const total = shukranCg + mdnCg + us.NJ + us.SHOWROOM + ankaraAtp + sezon
        + fbaUs + fbaUk + fbaEu + fbaCa + fbaAu + fbaAe + fbaSa;
      if (total === 0) continue;

      const desiRaw = prod?.desi;
      rows.push({
        iwasku,
        name: prod?.name ?? null,
        category: prod?.category ?? null,
        desi: desiRaw == null ? null : Number(desiRaw),
        shukranCg, mdnCg,
        nj: us.NJ, showroom: us.SHOWROOM,
        ankaraAtp, sezon,
        fbaUs, fbaUk, fbaEu, fbaCa, fbaAu, fbaAe, fbaSa,
        total,
      });
    }

    rows.sort((a, b) => b.total - a.total);
    return successResponse({ rows, count: rows.length });
  }
);
