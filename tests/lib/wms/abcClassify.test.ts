import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { shelfMovement: { groupBy: vi.fn() } },
}));

import { classifyAbc, toleranceForClass, frequencyDaysForClass } from '@/lib/wms/abcClassify';
import { prisma } from '@/lib/db/prisma';

const groupBy = vi.mocked(prisma.shelfMovement.groupBy);
beforeEach(() => groupBy.mockReset());

describe('toleranceForClass', () => {
  it('A=0, B=1, C/null=2', () => {
    expect(toleranceForClass('A')).toBe(0);
    expect(toleranceForClass('B')).toBe(1);
    expect(toleranceForClass('C')).toBe(2);
    expect(toleranceForClass(null)).toBe(2);
  });
});

describe('frequencyDaysForClass', () => {
  it('A=30, B=90, C/null=180', () => {
    expect(frequencyDaysForClass('A')).toBe(30);
    expect(frequencyDaysForClass('B')).toBe(90);
    expect(frequencyDaysForClass('C')).toBe(180);
    expect(frequencyDaysForClass(null)).toBe(180);
  });
});

describe('classifyAbc — Pareto sınırları', () => {
  const mockSkus = (counts: number[]) =>
    groupBy.mockResolvedValue(
      counts.map((c, i) => ({ iwasku: `SKU${i}`, _count: { _all: c } })) as never,
    );

  it('hareket yoksa boş map', async () => {
    groupBy.mockResolvedValue([] as never);
    const r = await classifyAbc('NJ');
    expect(r.size).toBe(0);
  });

  it('10 SKU → 2 A / 3 B / 5 C (A=%20, A+B=%50)', async () => {
    mockSkus([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
    const r = await classifyAbc('NJ');
    expect(r.get('SKU0')).toBe('A');
    expect(r.get('SKU1')).toBe('A');
    expect(r.get('SKU2')).toBe('B');
    expect(r.get('SKU4')).toBe('B');
    expect(r.get('SKU5')).toBe('C');
    expect(r.get('SKU9')).toBe('C');
    const classes = [...r.values()];
    expect(classes.filter((c) => c === 'A').length).toBe(2);
    expect(classes.filter((c) => c === 'B').length).toBe(3);
    expect(classes.filter((c) => c === 'C').length).toBe(5);
  });

  it('tek SKU → A (aLimit min 1)', async () => {
    mockSkus([5]);
    const r = await classifyAbc('NJ');
    expect(r.get('SKU0')).toBe('A');
  });

  it('en sık hareket eden A olur (sıralama count desc)', async () => {
    // Giriş sırası karışık; en yüksek count A olmalı
    groupBy.mockResolvedValue([
      { iwasku: 'LOW', _count: { _all: 1 } },
      { iwasku: 'HIGH', _count: { _all: 100 } },
    ] as never);
    const r = await classifyAbc('NJ');
    expect(r.get('HIGH')).toBe('A');
  });
});
