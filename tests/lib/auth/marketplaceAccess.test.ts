import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { userMarketplacePermission: { findMany: vi.fn() } },
}));

import {
  getMarketplaceAccess,
  canViewMarketplace,
  canEditMarketplace,
  type MarketplaceAccess,
} from '@/lib/auth/marketplaceAccess';
import { prisma } from '@/lib/db/prisma';

const findMany = vi.mocked(prisma.userMarketplacePermission.findMany);
beforeEach(() => findMany.mockReset());

describe('canViewMarketplace / canEditMarketplace', () => {
  it('allAccess her şeye izin verir', () => {
    const a: MarketplaceAccess = { allAccess: true, viewableCodes: new Set(), editableCodes: new Set() };
    expect(canViewMarketplace(a, 'Ama_US')).toBe(true);
    expect(canEditMarketplace(a, 'Etsy')).toBe(true);
  });
  it('kod listesine göre izin', () => {
    const a: MarketplaceAccess = {
      allAccess: false,
      viewableCodes: new Set(['Ama_US', 'Etsy']),
      editableCodes: new Set(['Ama_US']),
    };
    expect(canViewMarketplace(a, 'Etsy')).toBe(true);
    expect(canEditMarketplace(a, 'Etsy')).toBe(false); // sadece view
    expect(canEditMarketplace(a, 'Ama_US')).toBe(true);
    expect(canViewMarketplace(a, 'Walmart')).toBe(false);
  });
});

describe('getMarketplaceAccess', () => {
  it('admin → allAccess (DB sorgusu yok)', async () => {
    const a = await getMarketplaceAccess('u1', 'admin');
    expect(a.allAccess).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('edit yetkisi view\'i implicit verir', async () => {
    findMany.mockResolvedValue([
      { canView: false, canEdit: true, marketplace: { code: 'Ama_US' } },
      { canView: true, canEdit: false, marketplace: { code: 'Etsy' } },
    ] as never);
    const a = await getMarketplaceAccess('u1', 'editor');
    expect(a.allAccess).toBe(false);
    expect(a.editableCodes.has('Ama_US')).toBe(true);
    expect(a.viewableCodes.has('Ama_US')).toBe(true); // edit → view implicit
    expect(a.viewableCodes.has('Etsy')).toBe(true);
    expect(a.editableCodes.has('Etsy')).toBe(false);
  });

  it('izin yoksa boş erişim', async () => {
    findMany.mockResolvedValue([] as never);
    const a = await getMarketplaceAccess('u1', 'viewer');
    expect(a.allAccess).toBe(false);
    expect(a.viewableCodes.size).toBe(0);
    expect(a.editableCodes.size).toBe(0);
  });
});
