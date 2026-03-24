/**
 * Bulk Requests API
 * POST: Create multiple production requests from Excel upload
 */

import { NextRequest, NextResponse } from 'next/server';
import { ProductionRequest, EntryType, RequestStatus } from '@prisma/client';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';
import { BulkRequestSchema, formatValidationError } from '@/lib/validation/schemas';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';

const logger = createLogger('Bulk Requests API');

interface BulkRequestItem {
  iwasku: string;
  quantity: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 10 requests per minute for bulk operations
    const rateLimitResult = await rateLimiters.bulk.check(request, 'bulk-upload');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication & Authorization: Require editor or admin role
    const authResult = await requireRole(request, ['admin', 'editor']);
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

    // Fetch product details directly from database (FIX 3: Remove self-referencing fetch)
    const createdRequests: ProductionRequest[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const item of requests) {
      try {
        // Direct database query instead of self-referencing API call
        const products = await queryProductDb(
          'SELECT product_sku as iwasku, name, category, COALESCE(manual_size, size) as size FROM products WHERE product_sku = $1 LIMIT 1',
          [item.iwasku]
        );

        if (products.length === 0) {
          errors.push(`Ürün bulunamadı: ${item.iwasku}`);
          continue;
        }

        const product = products[0];

        // Warn if product has no size (desi) data
        if (!product.size) {
          warnings.push(`${item.iwasku}: Desi verisi eksik`);
        }

        const productionRequest = await prisma.productionRequest.create({
          data: {
            iwasku: item.iwasku,
            productName: product.name,
            productCategory: product.category || 'Kategorisiz',
            productSize: product.size ? parseFloat(product.size) : null,
            marketplaceId,
            quantity: item.quantity,
            requestDate,
            productionMonth, // YYYY-MM format (e.g., "2026-03")
            notes: item.notes || null,
            priority: item.priority ?? 'MEDIUM',
            entryType: EntryType.EXCEL,
            status: RequestStatus.REQUESTED,
            enteredById: user.id, // Real authenticated user
          },
        });

        createdRequests.push(productionRequest);
      } catch (error) {
        logger.error(`Failed to create request for ${item.iwasku}:`, error);
        errors.push(`Talep oluşturulamadı: ${item.iwasku}`);
      }
    }

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'BULK_UPLOAD',
      entityType: 'ProductionRequest',
      description: `Toplu yükleme: ${createdRequests.length} talep oluşturuldu, ${errors.length} hata (${productionMonth}, pazaryeri: ${marketplaceId})`,
      metadata: { created: createdRequests.length, errors, warnings, marketplaceId, productionMonth },
    });

    return NextResponse.json({
      success: true,
      data: {
        created: createdRequests.length,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    });
  } catch (error) {
    logger.error('Bulk create request error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Toplu talepler oluşturulamadı',
      },
      { status: 500 }
    );
  }
}
