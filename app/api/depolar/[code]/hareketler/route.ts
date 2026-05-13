/**
 * GET /api/depolar/[code]/hareketler
 * ShelfMovement audit log liste — filterable + pagination.
 *
 * Query params:
 *   type        — MovementType (INBOUND_FROM_SHIPMENT / INBOUND_MANUAL /
 *                 TRANSFER / CROSS_WAREHOUSE_TRANSFER / BOX_OPEN / OUTBOUND
 *                 / ADJUSTMENT / REVERSAL)
 *   refType     — OUTBOUND_ORDER / MANUAL_BOX / DELETE / CYCLE_COUNT etc.
 *   iwasku      — exact match
 *   shelfId     — fromShelfId VEYA toShelfId match
 *   userId      — kullanıcı id
 *   from, to    — ISO datetime (createdAt aralığı)
 *   limit       — default 100, max 500
 *   offset      — default 0
 *
 * Response: { rows: [...], total: N, hasMore: boolean }
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import type { Prisma } from '@prisma/client';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Hareketler alınamadı' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const sp = new URL(request.url).searchParams;
    const type = sp.get('type');
    const refType = sp.get('refType');
    const iwasku = sp.get('iwasku')?.trim();
    const shelfId = sp.get('shelfId');
    const userId = sp.get('userId');
    const from = sp.get('from');
    const to = sp.get('to');
    const limit = Math.min(Math.max(Number(sp.get('limit') ?? '100') || 100, 1), 500);
    const offset = Math.max(Number(sp.get('offset') ?? '0') || 0, 0);

    const where: Prisma.ShelfMovementWhereInput = { warehouseCode: upperCode };
    if (type) where.type = type as Prisma.ShelfMovementWhereInput['type'];
    if (refType) where.refType = refType;
    if (iwasku) where.iwasku = iwasku;
    if (userId) where.userId = userId;
    if (shelfId) where.OR = [{ fromShelfId: shelfId }, { toShelfId: shelfId }];
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      prisma.shelfMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { reversedBy: { select: { id: true } } },
      }),
      prisma.shelfMovement.count({ where }),
    ]);

    // Raf id → code lookup (tek seferde)
    const shelfIds = new Set<string>();
    for (const r of rows) {
      if (r.fromShelfId) shelfIds.add(r.fromShelfId);
      if (r.toShelfId) shelfIds.add(r.toShelfId);
    }
    const shelves =
      shelfIds.size > 0
        ? await prisma.shelf.findMany({
            where: { id: { in: Array.from(shelfIds) } },
            select: { id: true, code: true },
          })
        : [];
    const shelfCodeById = new Map(shelves.map((s) => [s.id, s.code]));

    // User id → name lookup
    const userIds = Array.from(new Set(rows.map((r) => r.userId).filter(Boolean)));
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return successResponse({
      rows: rows.map((m) => ({
        id: m.id,
        type: m.type,
        iwasku: m.iwasku,
        quantity: m.quantity,
        fromShelfId: m.fromShelfId,
        fromShelfCode: m.fromShelfId ? shelfCodeById.get(m.fromShelfId) ?? null : null,
        toShelfId: m.toShelfId,
        toShelfCode: m.toShelfId ? shelfCodeById.get(m.toShelfId) ?? null : null,
        shelfBoxId: m.shelfBoxId,
        refType: m.refType,
        refId: m.refId,
        userId: m.userId,
        userName: userById.get(m.userId)?.name ?? userById.get(m.userId)?.email ?? null,
        notes: m.notes,
        createdAt: m.createdAt,
        reverseOfId: m.reverseOfId,
        reversedByCount: m.reversedBy.length,
      })),
      total,
      hasMore: offset + rows.length < total,
    });
  }
);
