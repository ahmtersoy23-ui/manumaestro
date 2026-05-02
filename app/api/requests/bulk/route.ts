/**
 * Bulk Requests API
 * POST: Create multiple production requests from Excel upload
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma, EntryType, RequestStatus } from '@prisma/client';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';
import { BulkRequestSchema, formatValidationError } from '@/lib/validation/schemas';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { errorResponse } from '@/lib/api/response';

const logger = createLogger('Bulk Requests API');

export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 10 requests per minute for bulk operations
    const rateLimitResult = await rateLimiters.bulk.check(request, 'bulk-upload');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authorization: Süper-admin gerekli (toplu talep yükleme kritik aksiyon)
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const body = await request.json();

    // Validate input with Zod
    const validation = BulkRequestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Doğrulama hatası',
          details: formatValidationError(validation.error),
        },
        { status: 400 }
      );
    }

    const { marketplaceId, productionMonth, requests } = validation.data;

    // requestDate is always today (entry date)
    const requestDate = new Date();

    const errors: string[] = [];
    const warnings: string[] = [];

    // Batch product lookup: 1 query instead of N
    const uniqueIwaskus = [...new Set(requests.map(r => r.iwasku))];
    const placeholders = uniqueIwaskus.map((_, i) => `$${i + 1}`).join(',');
    const products = uniqueIwaskus.length > 0
      ? await queryProductDb(
          `SELECT product_sku as iwasku, name, category, COALESCE(manual_size, size) as size FROM products WHERE product_sku IN (${placeholders})`,
          uniqueIwaskus
        )
      : [];
    const productMap = new Map(products.map((p: { iwasku: string; name: string; category: string; size: number | null }) => [p.iwasku, p]));

    // Validate + prepare batch data
    const toCreate: Prisma.ProductionRequestCreateManyInput[] = [];

    for (const item of requests) {
      const product = productMap.get(item.iwasku);
      if (!product) {
        errors.push(`Ürün bulunamadı: ${item.iwasku}`);
        continue;
      }
      if (!product.size) {
        warnings.push(`${item.iwasku}: Desi verisi eksik`);
      }
      (toCreate as Array<Record<string, unknown>>).push({
        iwasku: item.iwasku,
        productName: product.name,
        productCategory: product.category || 'Kategorisiz',
        productSize: product.size ? parseFloat(String(product.size)) : null,
        marketplaceId,
        quantity: item.quantity,
        requestDate,
        productionMonth,
        notes: item.notes || null,
        priority: item.priority ?? 'MEDIUM',
        entryType: EntryType.EXCEL,
        status: RequestStatus.REQUESTED,
        enteredById: user.id,
      });
    }

    // Batch create: 1 query instead of N
    if ((toCreate as unknown[]).length > 0) {
      await prisma.productionRequest.createMany({ data: toCreate as never });
    }
    const createdCount = (toCreate as unknown[]).length;

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'BULK_UPLOAD',
      entityType: 'ProductionRequest',
      description: `Toplu yükleme: ${createdCount} talep oluşturuldu, ${errors.length} hata (${productionMonth}, pazaryeri: ${marketplaceId})`,
      metadata: { created: createdCount, errors, warnings, marketplaceId, productionMonth },
    });

    return NextResponse.json({
      success: true,
      data: {
        created: createdCount,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Toplu talepler oluşturulamadı');
  }
}
