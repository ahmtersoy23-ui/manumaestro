/**
 * POST /api/siparis/cg-export  { orderIds: string[] }
 *
 * "CG Bekliyor" (warehouseCode CG_SHUKRAN/CG_MDN) outbound order'larını Wayfair MCF
 * "Order Import Template" Excel'ine basar — hesap başına AYRI dosya (Shukran / MDN).
 *
 * Eşleşmeyen iwasku (Wayfair part number yok) varsa export ENGELLENİR → 409 + unmatched listesi;
 * operatör uygulama içinde mapping girer (POST /api/siparis/wayfair-map), sonra tekrar dener.
 *
 * Yetki: Manager+ (board manager). Dosyalar base64 olarak döner; frontend indirir.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';
import {
  resolveWayfairPartNumbers, parseAddressNote, buildMcfWorkbook,
  CG_RETAILER_ID, CG_ACCOUNT_LABEL, type ExportRow,
} from '@/lib/wisersell/wayfairExport';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisCgExport');

const Schema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(500),
});

const CG_CODES = ['CG_SHUKRAN', 'CG_MDN'];

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}`;
}

export async function POST(request: NextRequest) {
  const auth = await requireOrderBoardLevel(request, 'APPROVER');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const orders = await prisma.outboundOrder.findMany({
    where: { id: { in: parsed.data.orderIds }, source: 'WISERSELL_AUTO', warehouseCode: { in: CG_CODES } },
    include: { items: { select: { iwasku: true, quantity: true } } },
  });
  if (!orders.length) {
    return NextResponse.json({ success: false, error: 'CG sipariş bulunamadı (warehouseCode CG_SHUKRAN/CG_MDN olmalı)' }, { status: 404 });
  }

  const allIwaskus = [...new Set(orders.flatMap((o) => o.items.map((i) => i.iwasku)))];
  const [partMap, productMap] = await Promise.all([
    resolveWayfairPartNumbers(allIwaskus),
    getProductsByIwasku(allIwaskus),
  ]);

  // Eşleşmeyenleri topla → varsa engelle
  const unmatchedMap = new Map<string, { iwasku: string; productName: string | null; orderNumbers: string[] }>();
  for (const o of orders) {
    for (const it of o.items) {
      const pn = partMap.get(it.iwasku)?.partNumber ?? null;
      if (!pn) {
        const e = unmatchedMap.get(it.iwasku) ?? { iwasku: it.iwasku, productName: productMap.get(it.iwasku)?.name ?? null, orderNumbers: [] };
        if (!e.orderNumbers.includes(o.orderNumber)) e.orderNumbers.push(o.orderNumber);
        unmatchedMap.set(it.iwasku, e);
      }
    }
  }
  if (unmatchedMap.size) {
    return NextResponse.json(
      { success: false, error: 'Eşleşmeyen Wayfair part number var', unmatched: [...unmatchedMap.values()] },
      { status: 409 },
    );
  }

  // Hesap başına satırlar
  const rowsByAccount = new Map<string, ExportRow[]>();
  for (const o of orders) {
    const retailerId = CG_RETAILER_ID[o.warehouseCode];
    const addr = parseAddressNote(o.addressNote);
    for (const it of o.items) {
      const partNumber = partMap.get(it.iwasku)!.partNumber!;
      const row: ExportRow = {
        retailerId,
        poNumber: o.orderNumber,
        orderNumber: o.orderNumber,
        partNumber,
        quantity: it.quantity,
        name: addr.name ?? '',
        address1: addr.address1 ?? '',
        city: addr.city ?? '',
        state: addr.state ?? '',
        postalCode: addr.postalCode ?? '',
        country: 'US',
        phone: addr.phone ?? '',
        email: 'test@example.com',
      };
      const list = rowsByAccount.get(o.warehouseCode) ?? [];
      list.push(row);
      rowsByAccount.set(o.warehouseCode, list);
    }
  }

  const dateStr = ddmmyyyy(new Date());
  const files = await Promise.all([...rowsByAccount.entries()].map(async ([code, rows]) => {
    const account = CG_ACCOUNT_LABEL[code];
    const buf = await buildMcfWorkbook(rows);
    return {
      account,
      retailerId: CG_RETAILER_ID[code],
      filename: `MCF_Orders_${account}_${dateStr}.xlsx`,
      base64: buf.toString('base64'),
      orderCount: new Set(rows.map((r) => r.orderNumber)).size,
      rowCount: rows.length,
    };
  }));

  // Excel başarıyla üretildi → bu siparişleri "alındı" işaretle (tekrar export'a girmesinler).
  await prisma.outboundOrder.updateMany({
    where: { id: { in: orders.map((o) => o.id) } },
    data: { cgExportedAt: new Date() },
  });

  logger.info(`cg-export: ${orders.length} sipariş → ${files.length} dosya (${files.map((f) => `${f.account}:${f.rowCount}`).join(', ')}); cgExportedAt işaretlendi`);
  return NextResponse.json({ success: true, files });
}
