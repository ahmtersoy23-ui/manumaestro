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

    // Existing requests for same marketplace + productionMonth (upsert hedefleri)
    const existing = uniqueIwaskus.length > 0
      ? await prisma.productionRequest.findMany({
          where: {
            marketplaceId,
            productionMonth,
            iwasku: { in: uniqueIwaskus },
          },
          select: { id: true, iwasku: true },
        })
      : [];
    const existingMap = new Map(existing.map(e => [e.iwasku, e.id]));
    // Aynı iwasku dosyada birden fazla satırdaysa: son satır kazansın (Excel sırası)
    const dedupedRequests = new Map<string, typeof requests[number]>();
    for (const item of requests) {
      dedupedRequests.set(item.iwasku, item);
    }

    // Validate + ayır: yeni create vs. update
    const toCreate: Prisma.ProductionRequestCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; quantity: number; priority: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string | null }> = [];

    for (const item of dedupedRequests.values()) {
      const product = productMap.get(item.iwasku);
      if (!product) {
        errors.push(`Ürün bulunamadı: ${item.iwasku}`);
        continue;
      }
      if (!product.size) {
        warnings.push(`${item.iwasku}: Desi verisi eksik`);
      }
      const existingId = existingMap.get(item.iwasku);
      if (existingId) {
        toUpdate.push({
          id: existingId,
          quantity: item.quantity,
          priority: item.priority ?? 'MEDIUM',
          notes: item.notes || null,
        });
      } else {
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
    }

    // Batch create
    if ((toCreate as unknown[]).length > 0) {
      await prisma.productionRequest.createMany({ data: toCreate as never });
    }
    // Batch update (transaction icinde, paralel)
    if (toUpdate.length > 0) {
      await prisma.$transaction(
        toUpdate.map(u =>
          prisma.productionRequest.update({
            where: { id: u.id },
            data: { quantity: u.quantity, priority: u.priority, notes: u.notes },
          })
        )
      );
    }
    const createdCount = (toCreate as unknown[]).length;
    const updatedCount = toUpdate.length;

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'BULK_UPLOAD',
      entityType: 'ProductionRequest',
      description: `Toplu yükleme: ${createdCount} yeni, ${updatedCount} güncellendi, ${errors.length} hata (${productionMonth}, pazaryeri: ${marketplaceId})`,
      metadata: { created: createdCount, updated: updatedCount, errors, warnings, marketplaceId, productionMonth },
    });

    return NextResponse.json({
      success: true,
      data: {
        created: createdCount,
        updated: updatedCount,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Toplu talepler oluşturulamadı');
  }
}
