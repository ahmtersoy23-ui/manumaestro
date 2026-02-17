/**
 * Manufacturer Export API
 * Exports manufacturer production requests to Excel
 */

import { NextRequest, NextResponse } from 'next/server';
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
    // Rate limiting: 10 requests per minute for exports (same as bulk)
    const rateLimitResult = await rateLimiters.bulk.check(request, 'export-manufacturer');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication: Require any authenticated user
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const month = searchParams.get('month');

    // Build filter
    const where: any = {};

    if (category) {
      where.productCategory = decodeURIComponent(category);
    }

    if (month) {
      where.productionMonth = month;
    }


    // Fetch data from database
    const requests = await prisma.productionRequest.findMany({
      where,
      include: {
        marketplace: {
          select: {
            name: true,
            region: true,
          },
        },
      },
      orderBy: [
        { productCategory: 'asc' },
        { iwasku: 'asc' },
      ],
    });


    // Aggregate data by IWASKU (group marketplace requests)
    const aggregatedData = new Map<string, any>();

    requests.forEach((request: any) => {
      const key = request.iwasku;
      const existing = aggregatedData.get(key);

      if (existing) {
        // Add to existing product's marketplace list
        existing.marketplaces += `, ${request.marketplace.name}`;
        existing.totalRequestedQty += request.quantity;
      } else {
        // Create new entry
        aggregatedData.set(key, {
          iwasku: request.iwasku,
          productName: request.productName,
          productCategory: request.productCategory,
          marketplaces: request.marketplace.name,
          totalRequestedQty: request.quantity,
          producedQty: request.producedQuantity || 0,
          productSize: request.productSize || 0,
          totalDesi: (request.productSize || 0) * request.quantity,
          status: formatStatusForExcel(request.status),
          productionMonth: request.productionMonth,
          notes: request.notes || '',
          manufacturerNotes: request.manufacturerNotes || '',
        });
      }
    });

    const exportData = Array.from(aggregatedData.values());

    // Define columns for export
    const columns: ExportColumn[] = [
      { header: 'IWASKU', key: 'iwasku', width: 15 },
      { header: 'Ürün Adı', key: 'productName', width: 35 },
      { header: 'Kategori', key: 'productCategory', width: 20 },
      { header: 'Pazaryerleri', key: 'marketplaces', width: 25 },
      { header: 'Talep Edilen', key: 'totalRequestedQty', width: 15 },
      { header: 'Üretilen', key: 'producedQty', width: 15 },
      { header: 'Desi (Birim)', key: 'productSize', width: 15 },
      { header: 'Toplam Desi', key: 'totalDesi', width: 15 },
      { header: 'Durum', key: 'status', width: 15 },
      { header: 'Üretim Ayı', key: 'productionMonth', width: 15 },
      { header: 'Notlar', key: 'notes', width: 30 },
      { header: 'Üretici Notları', key: 'manufacturerNotes', width: 30 },
    ];

    // Generate Excel file
    const fileName = `manufacturer-export-${category || 'all'}-${month || 'all'}-${Date.now()}.xlsx`;
    const title = `Üretici Raporu${category ? ` - ${category}` : ''}${month ? ` - ${month}` : ''}`;

    const buffer = await exportToExcel(exportData, {
      sheetName: 'Üretim Talepleri',
      columns,
      fileName,
      title,
    });

    // Return Excel file
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to export data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
