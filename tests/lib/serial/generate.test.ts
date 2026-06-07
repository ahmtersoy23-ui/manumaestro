import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));

import { generateSerials } from '@/lib/serial/generate';
import { prisma } from '@/lib/db/prisma';

const queryRaw = vi.mocked(prisma.$queryRaw);
beforeEach(() => queryRaw.mockReset());

describe('generateSerials', () => {
  it('boş iwasku → hata', async () => {
    await expect(generateSerials('', 5)).rejects.toThrow('iwasku bos olamaz');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('quantity < 1 → boş dizi (DB sorgusu yok)', async () => {
    expect(await generateSerials('SKU', 0)).toEqual([]);
    expect(await generateSerials('SKU', -3)).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('quantity > 1000 → hata', async () => {
    await expect(generateSerials('SKU', 1001)).rejects.toThrow('en fazla 1000');
  });

  it('lastSerial=5, qty=3 → 6-hane padded ardışık seriler', async () => {
    queryRaw.mockResolvedValue([{ lastSerial: 5 }] as never);
    const r = await generateSerials('SCS0120VQKBY', 3);
    expect(r).toEqual([
      'SCS0120VQKBY-000003',
      'SCS0120VQKBY-000004',
      'SCS0120VQKBY-000005',
    ]);
  });

  it('tek seri (lastSerial=1)', async () => {
    queryRaw.mockResolvedValue([{ lastSerial: 1 }] as never);
    expect(await generateSerials('A', 1)).toEqual(['A-000001']);
  });

  it('6 haneyi aşan sayı kırpılmaz', async () => {
    queryRaw.mockResolvedValue([{ lastSerial: 1000000 }] as never);
    expect(await generateSerials('A', 1)).toEqual(['A-1000000']);
  });
});
