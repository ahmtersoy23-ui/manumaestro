/**
 * Warehouse Exit API
 * POST: Gönderim sonrası depo çıkışını WarehouseWeekly SHIPMENT entry'sine yazar
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

const WarehouseExitSchema = z.object({
  items: z.array(z.object({
    iwasku: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD (Pazartesi)
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    select: { destinationTab: true, name: true },
  });
  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  }

  // sendItems veya closeShipment izni olan kullanıcı çıkış da onaylayabilir
  let authUser;
  const authResult = await requireShipmentAction(request, shipment.destinationTab, 'sendItems');
  if (authResult instanceof NextResponse) {
    // sendItems izni yoksa closeShipment dene
    const authResult2 = await requireShipmentAction(request, shipment.destinationTab, 'closeShipment');
    if (authResult2 instanceof NextResponse) return authResult2;
    authUser = authResult2.user;
  } else {
    authUser = authResult.user;
  }
  const user = authUser;

  const body = await request.json();
  const validation = WarehouseExitSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { items, weekStart } = validation.data;
  const weekDate = new Date(weekStart + 'T00:00:00.000Z');

  // WarehouseWeekly SHIPMENT upsert — her iwasku için
  let totalUpdated = 0;
  for (const item of items) {
    // Önce mevcut entry var mı kontrol et
    const existing = await prisma.warehouseWeekly.findUnique({
      where: { iwasku_weekStart_type: { iwasku: item.iwasku, weekStart: weekDate, type: 'SHIPMENT' } },
    });

    if (existing) {
      await prisma.warehouseWeekly.update({
        where: { id: existing.id },
        data: { quantity: { increment: item.quantity } },
      });
    } else {
      // WarehouseProduct yoksa oluştur (depoda stoklanmayan ürün olabilir)
      await prisma.warehouseProduct.upsert({
        where: { iwasku: item.iwasku },
        create: { iwasku: item.iwasku },
        update: {},
      });
      await prisma.warehouseWeekly.create({
        data: {
          iwasku: item.iwasku,
          weekStart: weekDate,
          type: 'SHIPMENT',
          quantity: item.quantity,
          enteredById: user.id,
        },
      });
    }
    totalUpdated++;
  }

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'Shipment', entityId: id,
    description: `Depo çıkışı onaylandı: ${shipment.name} — ${items.length} urun, hafta ${weekStart}`,
  });

  return NextResponse.json({
    success: true,
    data: { updated: totalUpdated, weekStart },
  });
}
