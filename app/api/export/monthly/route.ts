/**
 * Monthly Export API
 * Exports monthly production data to Excel
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
    // Rate limiting: 10 requests per minute for exports
    const rateLimitResult = await rateLimiters.bulk.check(request, 'export-monthly');
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
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json(
        { error: 'Month parameter is required' },
        { status: 400 }
      );
    }


    // Fetch all requests for the month
    const requests = await prisma.productionRequest.findMany({
      where: {
        productionMonth: month,
      },
      include: {
        marketplace: {
          select: {
            name: true,
            code: true,
            region: true,
          },
        },
      },
      orderBy: [
        { productCategory: 'asc' },
        { iwasku: 'asc' },
      ],
    });


    // Format data for export
    const exportData = requests.map((request) => ({
      iwasku: request.iwasku,
      productName: request.productName,
      productCategory: request.productCategory,
      marketplace: request.marketplace.name,
      region: request.marketplace.region,
      requestedQty: request.quantity,
      producedQty: request.producedQuantity || 0,
      productSize: request.productSize || 0,
      totalDesi: (request.productSize || 0) * request.quantity,
      status: formatStatusForExcel(request.status),
      requestDate: formatDateForExcel(request.requestDate),
      productionMonth: request.productionMonth,
      notes: request.notes || '',
      manufacturerNotes: request.manufacturerNotes || '',
    }));

    // Define columns for export
    const columns: ExportColumn[] = [
      { header: 'IWASKU', key: 'iwasku', width: 15 },
      { header: 'Ürün Adı', key: 'productName', width: 35 },
      { header: 'Kategori', key: 'productCategory', width: 20 },
      { header: 'Pazaryeri', key: 'marketplace', width: 20 },
      { header: 'Bölge', key: 'region', width: 15 },
      { header: 'Talep Edilen', key: 'requestedQty', width: 15 },
      { header: 'Üretilen', key: 'producedQty', width: 15 },
      { header: 'Desi (Birim)', key: 'productSize', width: 15 },
      { header: 'Toplam Desi', key: 'totalDesi', width: 15 },
      { header: 'Durum', key: 'status', width: 15 },
      { header: 'Talep Tarihi', key: 'requestDate', width: 15 },
      { header: 'Üretim Ayı', key: 'productionMonth', width: 15 },
      { header: 'Notlar', key: 'notes', width: 30 },
      { header: 'Üretici Notları', key: 'manufacturerNotes', width: 30 },
    ];

    // Generate Excel file
    const fileName = `monthly-report-${month}-${Date.now()}.xlsx`;
    const title = `Aylık Üretim Raporu - ${month}`;

    const buffer = await exportToExcel(exportData, {
      sheetName: `Üretim ${month}`,
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
