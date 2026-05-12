/**
 * Bulk Requests API
 * POST: Create multiple production requests from Excel upload
 */

import { NextResponse } from 'next/server';
import { Prisma, EntryType, RequestStatus } from '@prisma/client';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { BulkRequestSchema, formatValidationError } from '@/lib/validation/schemas';
import { checkMarketplacePermission, isSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { revalidateTag } from 'next/cache';
import { isMonthLocked } from '@/lib/monthUtils';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const POST = withRoute(
  { rateLimit: 'bulk', fallbackMessage: 'Toplu talepler oluşturulamadı' },
  async ({ request, user }) => {
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

    // Yetkilendirme: süper-admin değilse, kilitli ay yasak + marketplace edit izni gerekli
    const userIsSuperAdmin = isSuperAdmin(user!.email);
    if (!userIsSuperAdmin) {
      if (isMonthLocked(productionMonth)) {
        return NextResponse.json(
          { success: false, error: `${productionMonth} ayı kilitli. Bu ay için talep girişi süper-admin yetkisi gerektirir.` },
          { status: 403 }
        );
      }
      const permCheck = await checkMarketplacePermission(user!.id, user!.role, marketplaceId, 'edit');
      if (!permCheck.allowed) {
        return NextResponse.json(
          { success: false, error: permCheck.reason || 'Bu pazar yerine talep oluşturamazsınız' },
          { status: 403 }
        );
      }
    }

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
          enteredById: user!.id,
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
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'BULK_UPLOAD',
      entityType: 'ProductionRequest',
      description: `Toplu yükleme: ${createdCount} yeni, ${updatedCount} güncellendi, ${errors.length} hata (${productionMonth}, pazaryeri: ${marketplaceId})`,
      metadata: { created: createdCount, updated: updatedCount, errors, warnings, marketplaceId, productionMonth },
    });

    if (createdCount > 0 || updatedCount > 0) revalidateTag('dashboard-stats', 'default');

    return successResponse({
      created: createdCount,
      updated: updatedCount,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  }
);
