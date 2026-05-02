/**
 * Stock Pools API
 * POST: Create new seasonal pool
 * GET: List all pools
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

const CreatePoolSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(30).regex(/^[A-Z0-9-]+$/, 'Sadece büyük harf, rakam ve tire'),
  poolType: z.enum(['SEASONAL', 'ROUTINE']).default('SEASONAL'),
  targetQuarter: z.string().optional(),
  productionStart: z.string().datetime().optional(),
  targetShipDate: z.string().datetime().optional(),
  totalTargetDesi: z.number().optional(),
  totalTargetUnits: z.number().int().optional(),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  // Süper-admin gerekli (yeni sezon havuzu oluşturma kritik aksiyon)
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const body = await request.json();
  const validation = CreatePoolSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const data = validation.data;

  // Check unique code
  const existing = await prisma.stockPool.findUnique({ where: { code: data.code } });
  if (existing) {
    return NextResponse.json(
      { success: false, error: `'${data.code}' kodu zaten kullanımda` },
      { status: 409 }
    );
  }

  const pool = await prisma.stockPool.create({
    data: {
      name: data.name,
      code: data.code,
      poolType: data.poolType,
      targetQuarter: data.targetQuarter,
      productionStart: data.productionStart ? new Date(data.productionStart) : null,
      targetShipDate: data.targetShipDate ? new Date(data.targetShipDate) : null,
      totalTargetDesi: data.totalTargetDesi,
      totalTargetUnits: data.totalTargetUnits,
      notes: data.notes,
    },
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'CREATE_REQUEST', entityType: 'StockPool', entityId: pool.id,
    description: `Sezon havuzu oluşturuldu: ${pool.name}`,
    metadata: { code: pool.code, poolType: pool.poolType },
  });

  return NextResponse.json({ success: true, data: pool }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['admin', 'editor', 'viewer']);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const poolType = searchParams.get('poolType');

  const pools = await prisma.stockPool.findMany({
    where: {
      ...(status ? { status: status as 'ACTIVE' | 'RELEASING' | 'COMPLETED' | 'CANCELLED' } : {}),
      ...(poolType ? { poolType: poolType as 'SEASONAL' | 'ROUTINE' } : {}),
    },
    include: {
      _count: { select: { reserves: true } },
      reserves: {
        select: {
          targetQuantity: true,
          targetDesi: true,
          producedQuantity: true,
          shippedQuantity: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate summary stats per pool
  const poolsWithStats = pools.map(pool => {
    const totalTarget = pool.reserves.reduce((s, r) => s + r.targetQuantity, 0);
    const totalTargetDesi = pool.reserves.reduce((s, r) => s + (r.targetDesi ?? 0), 0);
    const totalProduced = pool.reserves.reduce((s, r) => s + r.producedQuantity, 0);
    const totalShipped = pool.reserves.reduce((s, r) => s + r.shippedQuantity, 0);

    const { reserves: _reserves, ...poolData } = pool;

    return {
      ...poolData,
      stats: {
        reserveCount: pool._count.reserves,
        totalTargetUnits: totalTarget,
        totalTargetDesi: Math.round(totalTargetDesi),
        totalProduced,
        totalShipped,
        productionProgress: totalTarget > 0 ? Math.round(totalProduced / totalTarget * 100) : 0,
        shippingProgress: totalTarget > 0 ? Math.round(totalShipped / totalTarget * 100) : 0,
      },
    };
  });

  return NextResponse.json({ success: true, data: poolsWithStats });
}
