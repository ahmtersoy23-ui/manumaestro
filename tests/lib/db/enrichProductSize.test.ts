import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ queryProductDb: vi.fn() }));

import { enrichProductSize } from '@/lib/db/enrichProductSize';
import { queryProductDb } from '@/lib/db/prisma';

const q = vi.mocked(queryProductDb);
beforeEach(() => q.mockReset());

describe('enrichProductSize', () => {
  it('boş liste → DB sorgusu yok', async () => {
    await enrichProductSize([]);
    expect(q).not.toHaveBeenCalled();
  });

  it('size + name pricelab değeriyle güncellenir (Number cast)', async () => {
    q.mockResolvedValue([{ product_sku: 'A', size: '12.5', name: 'Masa' }] as never);
    const items = [{ iwasku: 'A', productSize: null as number | null, productName: '' }];
    await enrichProductSize(items);
    expect(items[0].productSize).toBe(12.5);
    expect(items[0].productName).toBe('Masa');
  });

  it('eşleşmeyen iwasku atlanır', async () => {
    q.mockResolvedValue([] as never);
    const items = [{ iwasku: 'X', productSize: 7 as number | null }];
    await enrichProductSize(items);
    expect(items[0].productSize).toBe(7); // değişmedi
  });

  it('product.size null ise mevcut size korunur', async () => {
    q.mockResolvedValue([{ product_sku: 'A', size: null, name: 'Masa' }] as never);
    const items = [{ iwasku: 'A', productSize: 9 as number | null, productName: 'eski' }];
    await enrichProductSize(items);
    expect(items[0].productSize).toBe(9); // size null → korundu
    expect(items[0].productName).toBe('Masa'); // name yine güncellendi
  });

  it("productName alanı yoksa eklenmez", async () => {
    q.mockResolvedValue([{ product_sku: 'A', size: '3', name: 'Masa' }] as never);
    const items = [{ iwasku: 'A', productSize: null as number | null }];
    await enrichProductSize(items);
    expect(items[0].productSize).toBe(3);
    expect('productName' in items[0]).toBe(false);
  });

  it('iwasku tekilleştirilir (tek IN sorgusu)', async () => {
    q.mockResolvedValue([] as never);
    await enrichProductSize([
      { iwasku: 'A', productSize: null },
      { iwasku: 'A', productSize: null },
      { iwasku: 'B', productSize: null },
    ]);
    const params = q.mock.calls[0][1] as string[];
    expect(params.sort()).toEqual(['A', 'B']);
  });
});
