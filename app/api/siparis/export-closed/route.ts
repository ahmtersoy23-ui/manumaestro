/**
 * POST /api/siparis/export-closed   (Manager+)
 *
 * Kapanan (SHIPPED) siparişleri Excel olarak verir — kargo bedeli mutabakatı için.
 * Kolonlar: Sipariş No · Tarih · Pazaryeri · Alıcı · Firma · Servis · Track No · Bedel · Para Birimi.
 * Bedel: Veeqo etiketlerinde otomatik, elle yüklenenlerde operatörün girdiği (label.cost).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisExportClosed');

/** Servis adından kargo firmasını çıkar (ör. "UPS® Ground" → UPS). */
function carrierFromService(s: string | null): string {
  const t = (s || '').toLowerCase();
  if (/ups/.test(t)) return 'UPS';
  if (/fedex/.test(t)) return 'FedEx';
  if (/usps|priority|ground advantage|first[- ]?class|parcel select/.test(t)) return 'USPS';
  if (/dhl/.test(t)) return 'DHL';
  return '';
}

export async function POST(request: NextRequest) {
  const auth = await requireBoardManager(request);
  if (auth instanceof NextResponse) return auth;

  const orders = await prisma.outboundOrder.findMany({
    where: { status: 'SHIPPED' },
    orderBy: { shippedAt: 'desc' },
    include: {
      labels: {
        where: { type: 'SHIPPING', archivedAt: null },
        select: { trackingNumber: true, cost: true, costCurrency: true, notes: true },
        orderBy: { uploadedAt: 'desc' }, take: 1,
      },
    },
  });

  const codes = [...new Set(orders.map((o) => o.marketplaceCode))];
  const mps = codes.length
    ? await prisma.marketplace.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
    : [];
  const mpName = new Map(mps.map((m) => [m.code, m.name]));

  // Alıcı: AUTO addressNote'ta 1. satır labelBase, 2. satır alıcı; MANUAL'da 1. satır alıcı.
  const recipientOf = (note: string | null, source: string): string => {
    const lines = (note ?? '').split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    return source === 'WISERSELL_AUTO' ? (lines[1] ?? lines[0]) : lines[0];
  };

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kapanan Siparişler');
  ws.columns = [
    { header: 'Sipariş No', key: 'orderNumber', width: 22 },
    { header: 'Tarih', key: 'date', width: 12 },
    { header: 'Pazaryeri', key: 'marketplace', width: 16 },
    { header: 'Alıcı', key: 'recipient', width: 24 },
    { header: 'Firma', key: 'carrier', width: 10 },
    { header: 'Servis', key: 'service', width: 28 },
    { header: 'Track No', key: 'tracking', width: 22 },
    { header: 'Bedel', key: 'cost', width: 10 },
    { header: 'Para Birimi', key: 'currency', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const o of orders) {
    const lbl = o.labels[0];
    ws.addRow({
      orderNumber: o.orderNumber,
      date: (o.shippedAt ?? o.createdAt).toISOString().slice(0, 10),
      marketplace: mpName.get(o.marketplaceCode) ?? o.marketplaceCode,
      recipient: recipientOf(o.addressNote, o.source),
      carrier: carrierFromService(lbl?.notes ?? null),
      service: (lbl?.notes ?? '').replace(/^Veeqo:\s*/, ''),
      tracking: lbl?.trackingNumber ?? o.manualTracking ?? '',
      cost: lbl?.cost != null ? Number(lbl.cost) : '',
      currency: lbl?.costCurrency ?? '',
    });
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const dateStr = new Date().toISOString().slice(0, 10);
  logger.info(`export-closed: ${orders.length} sipariş → xlsx`);
  return NextResponse.json({
    success: true,
    files: [{ filename: `Kapanan_Siparisler_${dateStr}.xlsx`, base64: buf.toString('base64'), rowCount: orders.length }],
  });
}
