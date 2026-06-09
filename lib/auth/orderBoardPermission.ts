/**
 * Sipariş board kademeli yetkilendirme (shelf/depo izinlerinden BAĞIMSIZ).
 *
 * Kümülatif merdiven (UserOrderPermission.level):
 *   NONE      → sadece görüntüleme
 *   APPROVER  → + Onayla / auto-run / Wisersell'de Kapat / Listeden Düş / CG-tracking-export rutinleri
 *   CREATOR   → + Manuel Giriş
 *   FULL      → + Veeqo Etiket Al / Manuel Sil / Açığa Al / Etiketi İptal
 *
 * SSO admin her zaman FULL sayılır (kayıt aranmaz).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyAuth, type VerifiedUser } from './verify';
import { OrderBoardLevel } from '@prisma/client';

const RANK: Record<OrderBoardLevel, number> = {
  NONE: 0,
  APPROVER: 1,
  CREATOR: 2,
  FULL: 3,
};

/** Kullanıcının sipariş board kademesi (admin → FULL, kayıt yoksa → NONE). */
export async function getOrderBoardLevel(user: VerifiedUser): Promise<OrderBoardLevel> {
  if (user.role === 'admin') return 'FULL';
  const perm = await prisma.userOrderPermission.findUnique({
    where: { userId: user.id },
    select: { level: true },
  });
  return perm?.level ?? 'NONE';
}

/** level, required kademesini karşılıyor mu? */
export function hasOrderLevel(level: OrderBoardLevel, required: OrderBoardLevel): boolean {
  return RANK[level] >= RANK[required];
}

/** Route guard: en az `required` kademe. Döner: { user, level } veya 401/403 yanıtı. */
export async function requireOrderBoardLevel(
  request: NextRequest,
  required: OrderBoardLevel,
): Promise<{ user: VerifiedUser; level: OrderBoardLevel } | NextResponse> {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json({ success: false, error: auth.error || 'Yetkisiz' }, { status: 401 });
  }
  const level = await getOrderBoardLevel(auth.user);
  if (!hasOrderLevel(level, required)) {
    return NextResponse.json(
      { success: false, error: `Bu işlem için sipariş yetkiniz yetersiz (gereken: ${required}, mevcut: ${level})` },
      { status: 403 },
    );
  }
  return { user: auth.user, level };
}
