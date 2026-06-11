import { NextResponse } from 'next/server';
import { checkStockPermission, type VerifiedUser } from '@/lib/auth/verify';

/**
 * Stok push yetki katmanı:
 *  - view  : görüntüle / listele / önizle (stok canView ya da admin)
 *  - edit  : config işlemleri — kural/standart adet (stok canEdit ya da admin)
 *  - admin : Aktif/Pasif + Çalıştır (sadece admin)
 * Pazaryeri ilgilisi (stok-edit izni) config yapar; çalıştırma/aktiflik admin'de kalır.
 */
export async function ensureStock(
  user: VerifiedUser | undefined,
  mode: 'view' | 'edit',
): Promise<NextResponse | null> {
  if (!user) return NextResponse.json({ success: false, error: 'Yetkisiz erişim' }, { status: 401 });
  const chk = await checkStockPermission(user.id, user.role, mode);
  if (!chk.allowed) return NextResponse.json({ success: false, error: chk.reason ?? 'Yetkisiz' }, { status: 403 });
  return null;
}

export function ensureAdmin(user: VerifiedUser | undefined): NextResponse | null {
  if (user?.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Bu işlem admin yetkisi gerektirir' }, { status: 403 });
  }
  return null;
}
