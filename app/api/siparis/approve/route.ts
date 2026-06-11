/**
 * POST /api/siparis/approve  { wisersellOrderIds: number[] }
 *
 * Onay (sipariş board en alt kademe, APPROVER+): Wisersell adaylarını
 * OutboundOrder + Kargoya Hazır'a çevirir.
 * Zaten oluşmuş ama Kargoya Hazır yazılamamış (ready-pending) siparişler için mark-ready retry yapar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { approveWisersellCandidates, type ApproveResult, type OrderSource } from '@/lib/wisersell/approve';
import { markWisersellReady } from '@/lib/wisersell/databridgeClient';
import { logAction } from '@/lib/auditLog';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisApprove');

const Schema = z.object({
  wisersellOrderIds: z.array(z.number().int().positive()).min(1).max(200),
  // Mobilya manuel kaynak seçimi: wisersellOrderId → 'TR' | depo. Yoksa otomatik routing.
  sources: z.record(z.string(), z.enum(['TR', 'NJ', 'SHOWROOM', 'CG_SHUKRAN', 'CG_MDN'])).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireOrderBoardLevel(request, 'APPROVER');
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
  const sourcesMap = parsed.data.sources
    ? new Map<number, OrderSource>(Object.entries(parsed.data.sources).map(([k, v]) => [Number(k), v as OrderSource]))
    : undefined;

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
    const fresh = await approveWisersellCandidates(freshIds, auth.user.id, sourcesMap);
    results.push(...fresh);
  }

  const approved = results.filter((r) => r.status === 'approved').length;
  const dismissedTr = results.filter((r) => r.status === 'dismissed_tr').length;
  logger.info(`approve: ${approved}/${ids.length} onaylandı (${results.filter(r => r.status === 'ready_pending').length} ready-pending)`);
  if (approved > 0) {
    await logAction({
      userId: auth.user.id, userName: auth.user.name, userEmail: auth.user.email,
      action: 'APPROVE_ORDER', entityType: 'OutboundOrder',
      entityId: results.filter((r) => r.status === 'approved' && r.orderId).map((r) => r.orderId).join(','),
      description: `${approved} sipariş onaylandı (Etiket/CG Bekliyor)`,
    });
  }
  if (dismissedTr > 0) {
    await logAction({
      userId: auth.user.id, userName: auth.user.name, userEmail: auth.user.email,
      action: 'APPROVE_ORDER', entityType: 'OutboundOrder',
      entityId: results.filter((r) => r.status === 'dismissed_tr').map((r) => String(r.wisersellOrderId)).join(','),
      description: `${dismissedTr} mobilya siparişi TR'den karşılanacak (board'dan gizlendi)`,
    });
  }
  return NextResponse.json({ success: true, results, approved, dismissedTr });
}
