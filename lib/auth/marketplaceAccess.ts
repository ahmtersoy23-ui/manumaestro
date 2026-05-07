/**
 * Marketplace yetki helper — UserMarketplacePermission tablosunu okuyarak
 * kullanıcının hangi marketplace'leri görebileceğini / düzenleyebileceğini
 * döndürür. Sipariş Çıkış akışında lobi/alt sayfa/yeni-sipariş gate'leri
 * için kullanılır.
 *
 * Admin SSO rolü = tüm marketplace'lerde view + edit.
 * Diğer kullanıcılar: izin tablosundan satır satır.
 */

import { prisma } from '@/lib/db/prisma';

export interface MarketplaceAccess {
  /** Tüm marketplace'lerde tam yetki (admin için) */
  allAccess: boolean;
  /** Görüntüleme izni olan marketplace.code listesi (allAccess true ise göz ardı) */
  viewableCodes: Set<string>;
  /** Düzenleme izni olan marketplace.code listesi */
  editableCodes: Set<string>;
}

const ADMIN_ROLES = new Set(['admin']);

export async function getMarketplaceAccess(
  userId: string,
  ssoRole: string
): Promise<MarketplaceAccess> {
  if (ADMIN_ROLES.has(ssoRole)) {
    return {
      allAccess: true,
      viewableCodes: new Set(),
      editableCodes: new Set(),
    };
  }

  const perms = await prisma.userMarketplacePermission.findMany({
    where: { userId, OR: [{ canView: true }, { canEdit: true }] },
    include: { marketplace: { select: { code: true } } },
  });

  const viewable = new Set<string>();
  const editable = new Set<string>();
  for (const p of perms) {
    if (p.canView) viewable.add(p.marketplace.code);
    if (p.canEdit) {
      editable.add(p.marketplace.code);
      // Edit yetkisi olan view'i de implicit alır
      viewable.add(p.marketplace.code);
    }
  }

  return { allAccess: false, viewableCodes: viewable, editableCodes: editable };
}

export function canViewMarketplace(access: MarketplaceAccess, code: string): boolean {
  return access.allAccess || access.viewableCodes.has(code);
}

export function canEditMarketplace(access: MarketplaceAccess, code: string): boolean {
  return access.allAccess || access.editableCodes.has(code);
}
