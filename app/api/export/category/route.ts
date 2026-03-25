/**
 * Category Export API
 * Exports production requests for a specific category to Excel (aggregated by IWASKU)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';
import {
  exportToExcel,
  formatStatusForExcel,
  type ExportColumn,
} from '@/lib/excel/exporter';

interface AggregatedProduct {
  iwasku: string;
  productName: string;
  marketplaces: string;
  totalRequestedQty: number;
  producedQty: number;
  productSize: number;
  totalDesi: number;
  status: string;
  productionMonth: string;
  notes: string;
  manufacturerNotes: string;
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimiters.bulk.check(request, 'export-category');
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
    const category = searchParams.get('category');
    const month = searchParams.get('month');

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'category parametresi gerekli' },
        { status: 400 }
      );
    }

    const decodedCategory = decodeURIComponent(category);

    const where: Prisma.ProductionRequestWhereInput = {
      productCategory: decodedCategory,
    };

    if (month) {
      where.productionMonth = month;
    }

    const requests = await prisma.productionRequest.findMany({
      where,
      take: 10000,
      include: {
        marketplace: {
          select: { name: true },
        },
      },
      orderBy: [
        { iwasku: 'asc' },
      ],
    });

    // Aggregate by IWASKU (same pattern as manufacturer export)
    const aggregatedData = new Map<string, AggregatedProduct>();

    requests.forEach((r) => {
      const key = r.iwasku;
      const existing = aggregatedData.get(key);

      if (existing) {
        existing.marketplaces += `, ${r.marketplace.name}`;
        existing.totalRequestedQty += r.quantity;
      } else {
        aggregatedData.set(key, {
          iwasku: r.iwasku,
          productName: r.productName,
          marketplaces: r.marketplace.name,
          totalRequestedQty: r.quantity,
          producedQty: r.producedQuantity || 0,
          productSize: r.productSize || 0,
          totalDesi: (r.productSize || 0) * r.quantity,
          status: formatStatusForExcel(r.status),
          productionMonth: r.productionMonth,
          notes: r.notes || '',
          manufacturerNotes: r.manufacturerNotes || '',
        });
      }
    });

    const exportData = Array.from(aggregatedData.values());

    const columns: ExportColumn[] = [
      { header: 'IWASKU', key: 'iwasku', width: 15 },
      { header: 'Ürün Adı', key: 'productName', width: 35 },
      { header: 'Pazaryerleri', key: 'marketplaces', width: 25 },
      { header: 'Talep Edilen', key: 'totalRequestedQty', width: 15 },
      { header: 'Üretilen', key: 'producedQty', width: 15 },
      { header: 'Desi (Birim)', key: 'productSize', width: 12 },
      { header: 'Toplam Desi', key: 'totalDesi', width: 12 },
      { header: 'Durum', key: 'status', width: 15 },
      { header: 'Üretim Ayı', key: 'productionMonth', width: 12 },
      { header: 'Notlar', key: 'notes', width: 30 },
      { header: 'Üretici Notları', key: 'manufacturerNotes', width: 30 },
    ];

    const fileName = `${decodedCategory.replace(/\s+/g, '-')}-${month || 'all'}-${Date.now()}.xlsx`;
    const title = `${decodedCategory}${month ? ` — ${month}` : ''}`;

    const buffer = await exportToExcel(exportData, {
      sheetName: decodedCategory.slice(0, 31), // Excel sheet name max 31 chars
      columns,
      fileName,
      title,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Veri dışa aktarılamadı' },
      { status: 500 }
    );
  }
}
