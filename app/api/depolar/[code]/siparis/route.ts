/**
 * GET  /api/depolar/[code]/siparis  — sipariş listesi (filtre: status, orderType)
 * POST /api/depolar/[code]/siparis  — yeni DRAFT yarat
 *
 * Sipariş çıkışı yalnız NJ + SHOWROOM'da; ANKARA için 400.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import type { Prisma } from '@prisma/client';

const SHELF_PRIMARY = new Set(['NJ', 'SHOWROOM']);

const CreateOrderSchema = z.object({
  orderType: z.enum(['SINGLE', 'FBA_PICKUP']),
  marketplaceCode: z.string().trim().min(1).max(50),
  orderNumber: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }
  if (!SHELF_PRIMARY.has(upperCode)) {
    return NextResponse.json(
      { success: false, error: 'Sipariş çıkışı yalnız NJ ve SHOWROOM depolarında' },
      { status: 400 }
    );
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status');
  const typeFilter = searchParams.get('orderType');

  const where: Prisma.OutboundOrderWhereInput = { warehouseCode: upperCode };
  if (statusFilter && ['DRAFT', 'SHIPPED', 'CANCELLED'].includes(statusFilter)) {
    where.status = statusFilter as 'DRAFT' | 'SHIPPED' | 'CANCELLED';
  }
  if (typeFilter && ['SINGLE', 'FBA_PICKUP'].includes(typeFilter)) {
    where.orderType = typeFilter as 'SINGLE' | 'FBA_PICKUP';
  }

  const orders = await prisma.outboundOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { _count: { select: { items: true } } },
  });

  // Toplu sayı: DRAFT/SHIPPED/CANCELLED + SINGLE/FBA_PICKUP
  const counts = await prisma.outboundOrder.groupBy({
    by: ['status', 'orderType'],
    where: { warehouseCode: upperCode },
    _count: true,
  });

  return NextResponse.json({
    success: true,
    data: {
      role: auth.shelfRole,
      orders: orders.map((o) => ({
        id: o.id,
        orderType: o.orderType,
        marketplaceCode: o.marketplaceCode,
        orderNumber: o.orderNumber,
        description: o.description,
        status: o.status,
        itemCount: o._count.items,
        createdAt: o.createdAt,
        shippedAt: o.shippedAt,
      })),
      counts,
    },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!SHELF_PRIMARY.has(upperCode)) {
    return NextResponse.json(
      { success: false, error: 'Sipariş çıkışı yalnız NJ ve SHOWROOM depolarında' },
      { status: 400 }
    );
  }

  const auth = await requireShelfAction(request, upperCode, 'createOutbound');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { orderType, marketplaceCode, orderNumber, description } = parsed.data;

  // Aynı (warehouse, marketplace, orderNumber) zaten DRAFT/SHIPPED ise hata
  const dup = await prisma.outboundOrder.findUnique({
    where: {
      warehouseCode_marketplaceCode_orderNumber: {
        warehouseCode: upperCode,
        marketplaceCode,
        orderNumber,
      },
    },
  });
  if (dup) {
    return NextResponse.json(
      { success: false, error: `Bu marketplace + sipariş no zaten var (status: ${dup.status})` },
      { status: 409 }
    );
  }

  const created = await prisma.outboundOrder.create({
    data: {
      warehouseCode: upperCode,
      orderType,
      marketplaceCode,
      orderNumber,
      description: description ?? null,
      status: 'DRAFT',
      createdById: auth.user.id,
    },
  });

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
