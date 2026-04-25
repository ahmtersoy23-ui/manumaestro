/**
 * GET /api/depolar/[code]/unmatched
 * Eşleşmeyen seed satırlarının PENDING listesi.
 * Query: status (PENDING/RESOLVED/SKIPPED — default PENDING)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? 'PENDING';
  if (!['PENDING', 'RESOLVED', 'SKIPPED'].includes(status)) {
    return NextResponse.json({ success: false, error: 'Geçersiz status' }, { status: 400 });
  }

  const rows = await prisma.unmatchedSeedRow.findMany({
    where: { warehouseCode: upperCode, status: status as 'PENDING' | 'RESOLVED' | 'SKIPPED' },
    orderBy: [{ rawLookup: 'asc' }, { shelfCode: 'asc' }],
    take: 1000,
  });

  // Aynı rawLookup'a göre gruplama bilgisi
  const groupCounts = new Map<string, { count: number; totalQty: number; sampleDescription: string | null }>();
  for (const r of rows) {
    const cur = groupCounts.get(r.rawLookup) ?? { count: 0, totalQty: 0, sampleDescription: r.description };
    cur.count++;
    cur.totalQty += r.quantity;
    groupCounts.set(r.rawLookup, cur);
  }

  return NextResponse.json({
    success: true,
    data: {
      role: auth.shelfRole,
      rows,
      groups: Array.from(groupCounts.entries()).map(([rawLookup, info]) => ({
        rawLookup,
        ...info,
      })),
    },
  });
}
