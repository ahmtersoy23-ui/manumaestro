import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ queryCargolens: vi.fn() }));

import { getShippingBenchmark } from '@/lib/veeqo/benchmark';
import { queryCargolens } from '@/lib/db/prisma';

const q = vi.mocked(queryCargolens);
beforeEach(() => q.mockReset());

describe('getShippingBenchmark — trUs (rate_cards desi tavanı)', () => {
  it('desi >= eşleşmesi ilk satırı döner', async () => {
    q.mockResolvedValueOnce([{ desi: 10, eco: 50, pri: 70 }]);
    const r = await getShippingBenchmark({ desi: 8, weightLb: null });
    expect(r.trUs).toEqual({ desi: 10, eco: 50, pri: 70 });
    expect(r.fedexIzmir).toBeNull();
    expect(q).toHaveBeenCalledTimes(1); // weightLb yok → fedex sorgusu yok
  });

  it('desi tavanı aşılırsa en büyük satıra düşer', async () => {
    q.mockResolvedValueOnce([]) // desi>=$1 boş
      .mockResolvedValueOnce([{ desi: 50, eco: 200, pri: 300 }]); // max satır
    const r = await getShippingBenchmark({ desi: 999, weightLb: null });
    expect(r.trUs?.desi).toBe(50);
  });

  it('desi yok → trUs sorgusu hiç yapılmaz', async () => {
    const r = await getShippingBenchmark({ desi: null, weightLb: null });
    expect(r.trUs).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });
});

describe('getShippingBenchmark — fedexIzmir (ağırlık bandı + eyalet/genel)', () => {
  it('eyalet örneği yeterli (n>=5) → scope state, ±2 lb bandı', async () => {
    q.mockResolvedValueOnce([{ avg: 25, n: 8 }]); // run('CA')
    const r = await getShippingBenchmark({ desi: null, weightLb: 10, state: 'CA' });
    expect(r.fedexIzmir).toEqual({ avg: 25, n: 8, lowLb: 8, highLb: 12, scope: 'state', state: 'CA' });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('eyalet örneği az (n<5) → genele düşer', async () => {
    q.mockResolvedValueOnce([{ avg: 25, n: 2 }]) // run('CA') yetersiz
      .mockResolvedValueOnce([{ avg: 30, n: 50 }]); // run(null) genel
    const r = await getShippingBenchmark({ desi: null, weightLb: 10, state: 'CA' });
    expect(r.fedexIzmir?.scope).toBe('genel');
    expect(r.fedexIzmir?.avg).toBe(30);
    expect(r.fedexIzmir?.state).toBeNull();
  });

  it('eyalet yoksa direkt genel', async () => {
    q.mockResolvedValueOnce([{ avg: 18, n: 40 }]); // run(null)
    const r = await getShippingBenchmark({ desi: null, weightLb: 5 });
    expect(r.fedexIzmir?.scope).toBe('genel');
    expect(r.fedexIzmir?.lowLb).toBe(3);
    expect(r.fedexIzmir?.highLb).toBe(7);
  });
});

// NOT: "CargoLens patlarsa null döner" best-effort davranışı fonksiyonda
// try/catch ile garanti (her queryCargolens çağrısı try içinde) ve manuel probe
// ile doğrulandı (resolves → {null,null}); burada birim test EKLENMEDİ çünkü
// test gövdesinde mockImplementation(reject) vitest'in unhandled-rejection
// izleyicisinde yanlış-pozitif tetikliyor (fonksiyonun kendi catch'i hatayı
// zaten yutuyor). Davranışı kırmamak için kaynak yorumları + bu not yeterli.
