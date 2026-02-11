/**
 * Bulk Requests API
 * POST: Create multiple production requests from Excel upload
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { EntryType, RequestStatus } from '@prisma/client';
import { createLogger } from '@/lib/logger';
import { BulkRequestSchema, formatValidationError } from '@/lib/validation/schemas';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';

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

    const body = await request.json();

    // Validate input with Zod
    const validation = BulkRequestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: formatValidationError(validation.error),
        },
        { status: 400 }
      );
    }

    const { marketplaceId, productionMonth, requests } = validation.data;

    // requestDate is always today (entry date)
    const requestDate = new Date();

    // Get admin user
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!adminUser) {
      return NextResponse.json(
        { error: 'No admin user found. Please run database seed.' },
        { status: 500 }
      );
    }

    // Fetch product details from external products API
    const createdRequests: any[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const item of requests) {
      try {
        // Fetch product info from products API
        const productRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/products/${encodeURIComponent(item.iwasku)}`);
        const productData = await productRes.json();

        if (!productData.success || !productData.data) {
          errors.push(`Product not found: ${item.iwasku}`);
          continue;
        }

        const product = productData.data;

        // Warn if product has no size (desi) data
        if (!product.size) {
          warnings.push(`${item.iwasku}: Missing desi data`);
        }

        const productionRequest = await prisma.productionRequest.create({
          data: {
            iwasku: item.iwasku,
            productName: product.name,
            productCategory: product.category || 'Uncategorized',
            productSize: product.size ? parseFloat(product.size) : null,
            marketplaceId,
            quantity: item.quantity,
            requestDate,
            productionMonth, // YYYY-MM format (e.g., "2026-03")
            notes: item.notes || null,
            entryType: EntryType.EXCEL,
            status: RequestStatus.REQUESTED,
            enteredById: adminUser.id,
          },
        });

        createdRequests.push(productionRequest);
      } catch (error) {
        logger.error(`Failed to create request for ${item.iwasku}:`, error);
        errors.push(`Failed to create request for ${item.iwasku}`);
      }
    }

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
        error: 'Failed to create bulk requests',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
