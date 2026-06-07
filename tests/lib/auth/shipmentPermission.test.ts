import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { userShipmentPermission: { findMany: vi.fn() } },
}));

import {
  destinationToPermissionTab,
  canDoAction,
  getShipmentRole,
  getAccessibleDestinations,
  type ShipmentRoleLevel,
} from '@/lib/auth/shipmentPermission';
import { prisma } from '@/lib/db/prisma';

const findMany = vi.mocked(prisma.userShipmentPermission.findMany);

beforeEach(() => findMany.mockReset());

describe('destinationToPermissionTab', () => {
  it('yeni destinasyon kodları → eski yetki tab', () => {
    expect(destinationToPermissionTab('NJ_DEPO')).toBe('US');
    expect(destinationToPermissionTab('CG_DEPO')).toBe('US');
    expect(destinationToPermissionTab('US_FBA')).toBe('US');
    expect(destinationToPermissionTab('UK_FBA')).toBe('UK');
    expect(destinationToPermissionTab('UK_DEPO')).toBe('UK');
    expect(destinationToPermissionTab('EU_FBA')).toBe('EU');
    expect(destinationToPermissionTab('CA_FBA')).toBe('CA');
    expect(destinationToPermissionTab('AU_FBA')).toBe('AU');
    expect(destinationToPermissionTab('ZA_TAKEALOT')).toBe('ZA');
    expect(destinationToPermissionTab('NL_DEPO')).toBe('NL');
  });
  it('legacy ülke kodları passthrough', () => {
    for (const t of ['US', 'UK', 'EU', 'NL', 'AU', 'ZA']) {
      expect(destinationToPermissionTab(t)).toBe(t);
    }
  });
});

describe('canDoAction', () => {
  it('rol yoksa her şey false', () => {
    expect(canDoAction(null, 'view')).toBe(false);
    expect(canDoAction(null, 'closeShipment')).toBe(false);
  });
  it('VIEWER sadece görür', () => {
    expect(canDoAction('VIEWER', 'view')).toBe(true);
    expect(canDoAction('VIEWER', 'createShipment')).toBe(false);
    expect(canDoAction('VIEWER', 'packItems')).toBe(false);
  });
  it('ROUTER yönlendirir ama paketlemez; PACKER tam tersi', () => {
    expect(canDoAction('ROUTER', 'routeItems')).toBe(true);
    expect(canDoAction('ROUTER', 'packItems')).toBe(false);
    expect(canDoAction('PACKER', 'packItems')).toBe(true);
    expect(canDoAction('PACKER', 'routeItems')).toBe(false);
  });
  it('MANAGER her şeyi yapar (createShipment + closeShipment dahil)', () => {
    expect(canDoAction('MANAGER', 'createShipment')).toBe(true);
    expect(canDoAction('MANAGER', 'closeShipment')).toBe(true);
  });
});

describe('getShipmentRole', () => {
  it('admin → MANAGER (DB sorgusu yok)', async () => {
    expect(await getShipmentRole('u1', 'admin', 'US')).toBe('MANAGER');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('izin yoksa null', async () => {
    findMany.mockResolvedValue([]);
    expect(await getShipmentRole('u1', 'editor', 'US')).toBeNull();
  });

  it('tek izin → o rol', async () => {
    findMany.mockResolvedValue([{ role: 'PACKER' }] as never);
    expect(await getShipmentRole('u1', 'editor', 'US')).toBe('PACKER');
  });

  it('birden çok izin → en yüksek seviye', async () => {
    findMany.mockResolvedValue([{ role: 'VIEWER' }, { role: 'MANAGER' }] as never);
    expect(await getShipmentRole('u1', 'editor', 'US')).toBe('MANAGER');
  });

  it('PACKER + ROUTER birlikte → MANAGER gibi davranır', async () => {
    findMany.mockResolvedValue([{ role: 'PACKER' }, { role: 'ROUTER' }] as never);
    const role: ShipmentRoleLevel | null = await getShipmentRole('u1', 'editor', 'US');
    expect(role).toBe('MANAGER');
  });

  it('yeni destinasyon kodu eski tab + * üzerinden sorgulanır', async () => {
    findMany.mockResolvedValue([{ role: 'ROUTER' }] as never);
    await getShipmentRole('u1', 'editor', 'NJ_DEPO');
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', destinationTab: { in: ['US', '*'] } },
      select: { role: true },
    });
  });
});

describe('getAccessibleDestinations', () => {
  it('admin → tüm ülkeler', async () => {
    expect(await getAccessibleDestinations('u1', 'admin')).toEqual(['US', 'UK', 'EU', 'NL', 'AU', 'ZA']);
  });
  it('* izni → tüm ülkeler', async () => {
    findMany.mockResolvedValue([{ destinationTab: '*' }] as never);
    expect(await getAccessibleDestinations('u1', 'editor')).toEqual(['US', 'UK', 'EU', 'NL', 'AU', 'ZA']);
  });
  it('belirli tab\'lar tekilleştirilir', async () => {
    findMany.mockResolvedValue([{ destinationTab: 'US' }, { destinationTab: 'US' }, { destinationTab: 'EU' }] as never);
    expect(await getAccessibleDestinations('u1', 'editor')).toEqual(['US', 'EU']);
  });
});
