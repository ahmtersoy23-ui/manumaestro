import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { userShelfPermission: { findMany: vi.fn() } },
}));

import {
  canDoShelfAction,
  getShelfRole,
  getAccessibleWarehouses,
} from '@/lib/auth/shelfPermission';
import { prisma } from '@/lib/db/prisma';

const findMany = vi.mocked(prisma.userShelfPermission.findMany);
beforeEach(() => findMany.mockReset());

describe('canDoShelfAction', () => {
  it('rol yoksa false', () => {
    expect(canDoShelfAction(null, 'view')).toBe(false);
    expect(canDoShelfAction(null, 'deleteStock')).toBe(false);
  });

  it('deleteStock + editStockQuantity YALNIZ ADMIN (kritik audit aksiyonları)', () => {
    for (const role of ['VIEWER', 'PACKER', 'OPERATOR', 'MANAGER'] as const) {
      expect(canDoShelfAction(role, 'deleteStock')).toBe(false);
      expect(canDoShelfAction(role, 'editStockQuantity')).toBe(false);
    }
    expect(canDoShelfAction('ADMIN', 'deleteStock')).toBe(true);
    expect(canDoShelfAction('ADMIN', 'editStockQuantity')).toBe(true);
  });

  it('managePermissions/manageWarehouseSettings YALNIZ ADMIN', () => {
    expect(canDoShelfAction('MANAGER', 'managePermissions')).toBe(false);
    expect(canDoShelfAction('ADMIN', 'managePermissions')).toBe(true);
  });

  it('OPERATOR transfer yapar, sipariş DRAFT yaratamaz', () => {
    expect(canDoShelfAction('OPERATOR', 'transferStock')).toBe(true);
    expect(canDoShelfAction('OPERATOR', 'crossWarehouseTransfer')).toBe(true);
    expect(canDoShelfAction('OPERATOR', 'createOutbound')).toBe(false);
  });

  it('PACKER sipariş çıkışı yapar, raf yönetmez', () => {
    expect(canDoShelfAction('PACKER', 'createOutbound')).toBe(true);
    expect(canDoShelfAction('PACKER', 'shipOutbound')).toBe(true);
    expect(canDoShelfAction('PACKER', 'createShelf')).toBe(false);
    expect(canDoShelfAction('PACKER', 'transferStock')).toBe(false);
  });

  it('undoAny yalnız MANAGER+; OPERATOR sadece kendi son hareketi', () => {
    expect(canDoShelfAction('OPERATOR', 'undoOwnRecent')).toBe(true);
    expect(canDoShelfAction('OPERATOR', 'undoAny')).toBe(false);
    expect(canDoShelfAction('MANAGER', 'undoAny')).toBe(true);
  });
});

describe('getShelfRole', () => {
  it('admin → ADMIN (DB sorgusu yok)', async () => {
    expect(await getShelfRole('u1', 'admin', 'ANKARA')).toBe('ADMIN');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('public depo (NL) + kayıt yok → VIEWER varsayılan', async () => {
    findMany.mockResolvedValue([]);
    expect(await getShelfRole('u1', 'editor', 'NL')).toBe('VIEWER');
  });

  it('public olmayan depo (ANKARA) + kayıt yok → null', async () => {
    findMany.mockResolvedValue([]);
    expect(await getShelfRole('u1', 'editor', 'ANKARA')).toBeNull();
  });

  it('birden çok izin → en yüksek seviye', async () => {
    findMany.mockResolvedValue([{ role: 'PACKER' }, { role: 'MANAGER' }] as never);
    expect(await getShelfRole('u1', 'editor', 'NJ')).toBe('MANAGER');
  });
});

describe('getAccessibleWarehouses', () => {
  it('admin → tüm depolar', async () => {
    expect(await getAccessibleWarehouses('u1', 'admin')).toEqual(['ANKARA', 'NJ', 'SHOWROOM', 'NL']);
  });
  it('* izni → tüm depolar', async () => {
    findMany.mockResolvedValue([{ warehouseCode: '*' }] as never);
    expect(await getAccessibleWarehouses('u1', 'editor')).toEqual(['ANKARA', 'NJ', 'SHOWROOM', 'NL']);
  });
  it('belirli depolar + public NL her zaman dahil', async () => {
    findMany.mockResolvedValue([{ warehouseCode: 'NJ' }] as never);
    const result = await getAccessibleWarehouses('u1', 'editor');
    expect(result).toContain('NJ');
    expect(result).toContain('NL'); // public her zaman dahil
  });
});
