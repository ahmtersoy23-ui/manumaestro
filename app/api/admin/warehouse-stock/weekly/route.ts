/**
 * Warehouse Weekly Entry API
 * POST: Upsert a weekly production entry for a product
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyAuth, checkStockPermission } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';
import { z } from 'zod';

const WeeklyEntrySchema = z.object({
  iwasku: z.string().min(1),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD (Monday)
  quantity: z.number().int().min(0),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
    }

    const permCheck = await checkStockPermission(auth.user.id, auth.user.role, 'edit');
    if (!permCheck.allowed) {
      return NextResponse.json({ success: false, error: permCheck.reason }, { status: 403 });
    }

    const body = await request.json();
    const validation = WeeklyEntrySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { iwasku, weekStart, quantity } = validation.data;
    const weekDate = new Date(weekStart);

    // Ensure product exists in warehouse
    await prisma.warehouseProduct.upsert({
      where: { iwasku },
      update: {},
      create: { iwasku },
    });

    // Upsert weekly entry
    const existing = await prisma.warehouseWeekly.findFirst({
      where: { iwasku, weekStart: weekDate },
    });

    let entry;
    if (quantity === 0 && existing) {
      // Delete entry if quantity is 0
      await prisma.warehouseWeekly.delete({ where: { id: existing.id } });
      entry = null;
    } else if (quantity > 0) {
      if (existing) {
        entry = await prisma.warehouseWeekly.update({
          where: { id: existing.id },
          data: { quantity, enteredById: auth.user.id },
        });
      } else {
        entry = await prisma.warehouseWeekly.create({
          data: { iwasku, weekStart: weekDate, quantity, enteredById: auth.user.id },
        });
      }
    }

    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    return errorResponse(error, 'Haftalık giriş güncellenemedi');
  }
}
