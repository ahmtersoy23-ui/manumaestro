/**
 * Sipariş board yetkilendirmesi (iki kademe):
 *  - requireBoardUser   → giriş yapmış HERHANGİ bir IWA kullanıcısı. Board görünürlüğü +
 *                         manuel sipariş oluşturma (DRAFT; fiziksel hareket yok).
 *  - requireBoardManager → US depolarında (NJ/SHOWROOM) MANAGER+ veya SSO admin. Wisersell
 *                         otomasyon aksiyonları (approve / auto-run / close) — Amazon/Wisersell'e
 *                         yazdığı için kısıtlı.
 *
 * Tehlikeli fiziksel aksiyonlar (etiket, çıkış/stok düşme) zaten kendi shelf izinleriyle
 * (requireShelfAction) ayrı korunuyor — bu helper onları kapsamaz.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, type VerifiedUser } from './verify';
import { getShelfRole } from './shelfPermission';

const US_WAREHOUSES = ['NJ', 'SHOWROOM'] as const;

/** US depolarında MANAGER+ (SSO admin → ADMIN, otomatik dahil) mi? */
export async function isBoardManager(user: VerifiedUser): Promise<boolean> {
  for (const wh of US_WAREHOUSES) {
    const role = await getShelfRole(user.id, user.role, wh);
    if (role === 'MANAGER' || role === 'ADMIN') return true;
  }
  return false;
}

/** Board görünürlük + manuel oluşturma: giriş yapmış herhangi bir kullanıcı. */
export async function requireBoardUser(
  request: NextRequest,
): Promise<{ user: VerifiedUser } | NextResponse> {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json({ success: false, error: auth.error || 'Yetkisiz' }, { status: 401 });
  }
  return { user: auth.user };
}

/** Wisersell otomasyon aksiyonları: Manager+ gate. */
export async function requireBoardManager(
  request: NextRequest,
): Promise<{ user: VerifiedUser } | NextResponse> {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json({ success: false, error: auth.error || 'Yetkisiz' }, { status: 401 });
  }
  if (!(await isBoardManager(auth.user))) {
    return NextResponse.json(
      { success: false, error: 'Bu işlem için Manager yetkisi gerekli (NJ/SHOWROOM)' },
      { status: 403 },
    );
  }
  return { user: auth.user };
}
