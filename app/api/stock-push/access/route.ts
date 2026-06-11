import { NextResponse } from 'next/server';
import { checkStockPermission } from '@/lib/auth/verify';
import { withRoute } from '@/lib/api/withRoute';

/**
 * GET /api/stock-push/access — geçerli kullanıcının stok-push yetki seviyesi.
 * Sayfa buna göre admin-only satırı (Aktif/Çalıştır) ve edit kontrollerini gösterir.
 * (Paylaşımlı /api/auth/me'ye dokunmamak için ayrı uç — paralel session güvenliği.)
 */
export const GET = withRoute({ rateLimit: 'read' }, async ({ user }) => {
  const isAdmin = user!.role === 'admin';
  const view = await checkStockPermission(user!.id, user!.role, 'view');
  const edit = await checkStockPermission(user!.id, user!.role, 'edit');
  return NextResponse.json({
    success: true,
    isAdmin,
    canView: view.allowed,
    canEdit: edit.allowed,
  });
});
