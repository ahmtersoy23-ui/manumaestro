/**
 * Bulk Requests API
 * POST: Create multiple production requests from Excel upload
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { EntryType, RequestStatus } from '@prisma/client';

interface BulkRequestItem {
  iwasku: string;
  quantity: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketplaceId, productionMonth, requests } = body as {
      marketplaceId: string;
      productionMonth: string;
      requests: BulkRequestItem[];
    };

    // Validation
    if (!marketplaceId || !productionMonth || !requests || requests.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Parse production month to set request date
    const [year, month] = productionMonth.split('-').map(Number);
    const requestDate = new Date(year, month - 1, 1); // First day of the month

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
            notes: item.notes || null,
            entryType: EntryType.EXCEL,
            status: RequestStatus.REQUESTED,
            enteredById: adminUser.id,
          },
        });

        createdRequests.push(productionRequest);
      } catch (error) {
        console.error(`Failed to create request for ${item.iwasku}:`, error);
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
    console.error('Bulk create request error:', error);
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
