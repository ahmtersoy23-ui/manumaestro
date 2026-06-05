/**
 * POST /api/siparis/approve  { wisersellOrderIds: number[] }
 *
 * Süper-admin: Wisersell adaylarını onaylar (OutboundOrder + Kargoya Hazır).
 * Zaten oluşmuş ama Kargoya Hazır yazılamamış (ready-pending) siparişler için mark-ready retry yapar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { approveWisersellCandidates, type ApproveResult } from '@/lib/wisersell/approve';
import { markWisersellReady } from '@/lib/wisersell/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisApprove');

const Schema = z.object({
  wisersellOrderIds: z.array(z.number().int().positive()).min(1).max(200),
});

export async function POST(request: NextRequest) {
  const auth = await requireBoardManager(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const ids = parsed.data.wisersellOrderIds;

  // Zaten oluşmuş (ready-pending) siparişler → mark-ready retry; gerisi → fresh approve
  const existing = await prisma.outboundOrder.findMany({
    where: { wisersellOrderId: { in: ids }, source: 'WISERSELL_AUTO' },
    select: { id: true, wisersellOrderId: true, wisersellReadyAt: true },
  });
  const existingById = new Map(existing.map((o) => [o.wisersellOrderId!, o]));
  const freshIds = ids.filter((id) => !existingById.has(id));

  const results: ApproveResult[] = [];

  // Retry ready-pending
  for (const o of existing) {
    if (o.wisersellReadyAt) {
      results.push({ wisersellOrderId: o.wisersellOrderId!, ok: true, status: 'skipped', message: 'Zaten onaylı' });
      continue;
    }
    try {
      await markWisersellReady([o.wisersellOrderId!]);
      await prisma.outboundOrder.update({ where: { id: o.id }, data: { wisersellReadyAt: new Date() } });
      results.push({ wisersellOrderId: o.wisersellOrderId!, ok: true, status: 'approved', orderId: o.id, message: 'Kargoya Hazır (retry) yazıldı' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ wisersellOrderId: o.wisersellOrderId!, ok: true, status: 'ready_pending', orderId: o.id, message: `Retry başarısız: ${msg.slice(0, 120)}` });
    }
  }

  // Fresh approve
  if (freshIds.length) {
    const fresh = await approveWisersellCandidates(freshIds, auth.user.id);
    results.push(...fresh);
  }

  const approved = results.filter((r) => r.status === 'approved').length;
  logger.info(`approve: ${approved}/${ids.length} onaylandı (${results.filter(r => r.status === 'ready_pending').length} ready-pending)`);
  return NextResponse.json({ success: true, results, approved });
}
