/**
 * Marketplace Export API
 * Exports production requests for a specific marketplace to Excel
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';
import {
  exportToExcel,
  formatDateForExcel,
  formatStatusForExcel,
  type ExportColumn,
} from '@/lib/excel/exporter';

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimiters.bulk.check(request, 'export-marketplace');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const marketplaceId = searchParams.get('marketplaceId');
    const month = searchParams.get('month');

    if (!marketplaceId) {
      return NextResponse.json(
        { success: false, error: 'marketplaceId parametresi gerekli' },
        { status: 400 }
      );
    }

    // Get marketplace name for title
    const marketplace = await prisma.marketplace.findUnique({
      where: { id: marketplaceId },
      select: { name: true, code: true },
    });

    if (!marketplace) {
      return NextResponse.json(
        { success: false, error: 'Pazar yeri bulunamadı' },
        { status: 404 }
      );
    }

    const where: Prisma.ProductionRequestWhereInput = {
      marketplaceId,
    };

    if (month) {
      where.productionMonth = month;
    }

    const requests = await prisma.productionRequest.findMany({
      where,
      take: 10000,
      orderBy: [
        { productCategory: 'asc' },
        { iwasku: 'asc' },
      ],
    });

    // Fetch produced values from MonthSnapshot
    const snapshots = month
      ? await prisma.monthSnapshot.findMany({
          where: { month },
          select: { iwasku: true, produced: true },
        })
      : [];
    const producedMap = new Map(snapshots.map(s => [s.iwasku, s.produced]));

    const exportData = requests.map(r => ({
      iwasku: r.iwasku,
      productName: r.productName,
      productCategory: r.productCategory,
      quantity: r.quantity,
      producedQuantity: producedMap.get(r.iwasku) ?? 0,
      productSize: r.productSize || 0,
      totalDesi: (r.productSize || 0) * r.quantity,
      status: formatStatusForExcel(r.status),
      productionMonth: r.productionMonth,
      requestDate: formatDateForExcel(r.requestDate),
      notes: r.notes || '',
      manufacturerNotes: r.manufacturerNotes || '',
    }));

    const columns: ExportColumn[] = [
      { header: 'IWASKU', key: 'iwasku', width: 15 },
      { header: 'Ürün Adı', key: 'productName', width: 35 },
      { header: 'Kategori', key: 'productCategory', width: 20 },
      { header: 'Miktar', key: 'quantity', width: 12 },
      { header: 'Üretilen', key: 'producedQuantity', width: 12 },
      { header: 'Desi (Birim)', key: 'productSize', width: 12 },
      { header: 'Toplam Desi', key: 'totalDesi', width: 12 },
      { header: 'Durum', key: 'status', width: 15 },
      { header: 'Üretim Ayı', key: 'productionMonth', width: 12 },
      { header: 'Talep Tarihi', key: 'requestDate', width: 14 },
      { header: 'Notlar', key: 'notes', width: 30 },
      { header: 'Üretici Notları', key: 'manufacturerNotes', width: 30 },
    ];

    const fileName = `${marketplace.code}-${month || 'all'}-${Date.now()}.xlsx`;
    const title = `${marketplace.name}${month ? ` — ${month}` : ''}`;

    const buffer = await exportToExcel(exportData, {
      sheetName: marketplace.name,
      columns,
      fileName,
      title,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    });
  } catch (_error) {
    return NextResponse.json(
      { success: false, error: 'Veri dışa aktarılamadı' },
      { status: 500 }
    );
  }
}
