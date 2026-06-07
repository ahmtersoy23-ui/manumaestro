import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ queryProductDb: vi.fn() }));

import { getCgAvailability } from '@/lib/wms/cgStock';
import { queryProductDb } from '@/lib/db/prisma';

const q = vi.mocked(queryProductDb);
beforeEach(() => q.mockReset());

describe('getCgAvailability', () => {
  it('boş/whitespace giriş → boş map, DB sorgusu yok', async () => {
    expect((await getCgAvailability([])).size).toBe(0);
    expect((await getCgAvailability(['', '  '])).size).toBe(0);
    expect(q).not.toHaveBeenCalled();
  });

  it('WFS=Shukran, WFM=MDN eşlenir', async () => {
    q.mockResolvedValue([{ iwasku: 'A', shukran: 5, mdn: 3 }] as never);
    const r = await getCgAvailability(['A']);
    expect(r.get('A')).toEqual({ CG_SHUKRAN: 5, CG_MDN: 3 });
  });

  it('negatif/null → 0 clamp', async () => {
    q.mockResolvedValue([{ iwasku: 'A', shukran: -2, mdn: null }] as never);
    expect(r0(await getCgAvailability(['A']))).toEqual({ CG_SHUKRAN: 0, CG_MDN: 0 });
  });

  it('giriş trim + tekilleştirme', async () => {
    q.mockResolvedValue([] as never);
    await getCgAvailability([' A ', 'A', 'B']);
    const params = q.mock.calls[0][1] as string[];
    expect(params.sort()).toEqual(['A', 'B']);
  });
});

function r0(m: Map<string, { CG_SHUKRAN: number; CG_MDN: number }>) {
  return m.get('A');
}
