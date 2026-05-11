import { describe, expect, it } from 'vitest';
import {
  sortByFifo,
  suggestPick,
  type PickCandidate,
} from '@/lib/wms/fifoSuggest';

function cand(
  partial: Partial<PickCandidate> & {
    locationId: string;
    ageReference: Date;
    availableQty: number;
  }
): PickCandidate {
  return {
    source: partial.source ?? 'STOCK',
    locationId: partial.locationId,
    shelfId: `shelf-${partial.locationId}`,
    shelfCode: partial.shelfCode ?? partial.locationId,
    shelfType: partial.shelfType ?? 'NORMAL',
    availableQty: partial.availableQty,
    ageReference: partial.ageReference,
    boxNumber: partial.boxNumber,
    fnsku: partial.fnsku,
    marketplaceCode: partial.marketplaceCode,
    status: partial.status,
  };
}

const NOW = new Date('2026-05-12T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('sortByFifo', () => {
  it('eski tarih önce gelir', () => {
    const out = sortByFifo([
      cand({ locationId: 'A', ageReference: daysAgo(3), availableQty: 10 }),
      cand({ locationId: 'B', ageReference: daysAgo(30), availableQty: 10 }),
      cand({ locationId: 'C', ageReference: daysAgo(10), availableQty: 10 }),
    ]);
    expect(out.map((c) => c.locationId)).toEqual(['B', 'C', 'A']);
  });

  it('aynı tarihte NORMAL > POOL > TEMP zone önceliği', () => {
    const ref = daysAgo(5);
    const out = sortByFifo([
      cand({ locationId: 'POOL1', ageReference: ref, shelfType: 'POOL', availableQty: 10 }),
      cand({ locationId: 'TEMP1', ageReference: ref, shelfType: 'TEMP', availableQty: 10 }),
      cand({ locationId: 'NORM1', ageReference: ref, shelfType: 'NORMAL', availableQty: 10 }),
    ]);
    expect(out.map((c) => c.locationId)).toEqual(['NORM1', 'POOL1', 'TEMP1']);
  });

  it('aynı tarih ve zone ise shelfCode alfabetik', () => {
    const ref = daysAgo(2);
    const out = sortByFifo([
      cand({ locationId: 'X', shelfCode: 'C-02', ageReference: ref, availableQty: 5 }),
      cand({ locationId: 'Y', shelfCode: 'A-01', ageReference: ref, availableQty: 5 }),
      cand({ locationId: 'Z', shelfCode: 'B-03', ageReference: ref, availableQty: 5 }),
    ]);
    expect(out.map((c) => c.shelfCode)).toEqual(['A-01', 'B-03', 'C-02']);
  });

  it('bilinmeyen zone tipi sona düşer', () => {
    const ref = daysAgo(1);
    const out = sortByFifo([
      cand({ locationId: 'A', shelfType: 'POOL', ageReference: ref, availableQty: 5 }),
      cand({ locationId: 'B', shelfType: 'UNKNOWN', ageReference: ref, availableQty: 5 }),
      cand({ locationId: 'C', shelfType: 'NORMAL', ageReference: ref, availableQty: 5 }),
    ]);
    expect(out.map((c) => c.locationId)).toEqual(['C', 'A', 'B']);
  });

  it('giriş array\'i mutate etmez', () => {
    const input: PickCandidate[] = [
      cand({ locationId: 'A', ageReference: daysAgo(1), availableQty: 10 }),
      cand({ locationId: 'B', ageReference: daysAgo(10), availableQty: 10 }),
    ];
    const snapshot = [...input];
    sortByFifo(input);
    expect(input).toEqual(snapshot);
  });
});

describe('suggestPick', () => {
  it('boş candidate listesi → boş öneri + remaining=istenilen', () => {
    const out = suggestPick([], 10, NOW);
    expect(out.suggestions).toEqual([]);
    expect(out.remaining).toBe(10);
  });

  it('qtyNeeded <= 0 → boş öneri', () => {
    const out = suggestPick(
      [cand({ locationId: 'A', ageReference: daysAgo(5), availableQty: 100 })],
      0,
      NOW
    );
    expect(out.suggestions).toEqual([]);
    expect(out.remaining).toBe(0);
  });

  it('tek konum tamamen karşılayabiliyorsa split etmez (single-location bias)', () => {
    // İki konum da yeterli ama eski olan tercih edilir
    const out = suggestPick(
      [
        cand({ locationId: 'YENI', ageReference: daysAgo(2), availableQty: 50 }),
        cand({ locationId: 'ESKI', ageReference: daysAgo(20), availableQty: 50 }),
      ],
      30,
      NOW
    );
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].locationId).toBe('ESKI');
    expect(out.suggestions[0].suggestedQty).toBe(30);
    expect(out.remaining).toBe(0);
  });

  it('hiçbir tek konum karşılayamıyorsa FIFO sırasıyla split eder', () => {
    const out = suggestPick(
      [
        cand({ locationId: 'A', ageReference: daysAgo(5), availableQty: 30 }),
        cand({ locationId: 'B', ageReference: daysAgo(20), availableQty: 30 }),
        cand({ locationId: 'C', ageReference: daysAgo(10), availableQty: 30 }),
      ],
      70,
      NOW
    );
    expect(out.suggestions.map((s) => s.locationId)).toEqual(['B', 'C', 'A']);
    expect(out.suggestions.map((s) => s.suggestedQty)).toEqual([30, 30, 10]);
    expect(out.remaining).toBe(0);
  });

  it('yetersiz toplam stok → remaining > 0', () => {
    const out = suggestPick(
      [
        cand({ locationId: 'A', ageReference: daysAgo(5), availableQty: 10 }),
        cand({ locationId: 'B', ageReference: daysAgo(8), availableQty: 5 }),
      ],
      30,
      NOW
    );
    expect(out.suggestions).toHaveLength(2);
    expect(out.suggestions.reduce((s, x) => s + x.suggestedQty, 0)).toBe(15);
    expect(out.remaining).toBe(15);
  });

  it('availableQty=0 konumlar split sırasında atlanır', () => {
    const out = suggestPick(
      [
        cand({ locationId: 'A', ageReference: daysAgo(30), availableQty: 0 }),
        cand({ locationId: 'B', ageReference: daysAgo(10), availableQty: 20 }),
      ],
      15,
      NOW
    );
    // single-location bias: B 15'i karşılıyor
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].locationId).toBe('B');
    expect(out.suggestions[0].suggestedQty).toBe(15);
    expect(out.remaining).toBe(0);
  });

  it('BOX + STOCK karışık candidate listesi FIFO\'ya uyar', () => {
    const out = suggestPick(
      [
        cand({
          locationId: 'BOX1',
          source: 'BOX',
          boxNumber: 'K-01',
          ageReference: daysAgo(15),
          availableQty: 10,
        }),
        cand({
          locationId: 'STK1',
          source: 'STOCK',
          ageReference: daysAgo(40),
          availableQty: 10,
        }),
      ],
      15,
      NOW
    );
    // En eski STK1; sonra BOX1
    expect(out.suggestions.map((s) => s.locationId)).toEqual(['STK1', 'BOX1']);
    expect(out.suggestions[0].source).toBe('STOCK');
    expect(out.suggestions[1].source).toBe('BOX');
    expect(out.suggestions[1].boxNumber).toBe('K-01');
  });

  it('rationale: tek konum açıklaması "Tek konum" ile başlar', () => {
    const out = suggestPick(
      [cand({ locationId: 'A', ageReference: daysAgo(7), availableQty: 100, shelfType: 'NORMAL' })],
      10,
      NOW
    );
    expect(out.suggestions[0].rationale).toContain('Tek konum');
    expect(out.suggestions[0].rationale).toContain('forward');
    expect(out.suggestions[0].ageDays).toBe(7);
  });

  it('rationale: BOX kaynaklı split koli numarasını içerir', () => {
    const out = suggestPick(
      [
        cand({
          locationId: 'BOX1',
          source: 'BOX',
          boxNumber: 'KOLI-42',
          ageReference: daysAgo(5),
          availableQty: 10,
        }),
        cand({ locationId: 'STK', ageReference: daysAgo(2), availableQty: 10 }),
      ],
      15,
      NOW
    );
    const boxSugg = out.suggestions.find((s) => s.source === 'BOX');
    expect(boxSugg?.rationale).toContain('KOLI-42');
  });

  it('rationale: bugün eklenen konum "bugün" der', () => {
    const out = suggestPick(
      [cand({ locationId: 'A', ageReference: NOW, availableQty: 100 })],
      5,
      NOW
    );
    expect(out.suggestions[0].rationale).toContain('bugün');
    expect(out.suggestions[0].ageDays).toBe(0);
  });

  it('ageDays gelecek tarih için 0 (negative değil)', () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    const out = suggestPick(
      [cand({ locationId: 'A', ageReference: future, availableQty: 100 })],
      5,
      NOW
    );
    expect(out.suggestions[0].ageDays).toBe(0);
  });

  it('split iken order numarası 1\'den artar', () => {
    const out = suggestPick(
      [
        cand({ locationId: 'A', ageReference: daysAgo(30), availableQty: 5 }),
        cand({ locationId: 'B', ageReference: daysAgo(20), availableQty: 5 }),
        cand({ locationId: 'C', ageReference: daysAgo(10), availableQty: 5 }),
      ],
      15,
      NOW
    );
    expect(out.suggestions.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('aynı tarih + zone ortamında shelfCode tie-break ile FIFO bütünleşir', () => {
    const ref = daysAgo(10);
    const out = suggestPick(
      [
        cand({ locationId: 'X', shelfCode: 'C', shelfType: 'NORMAL', ageReference: ref, availableQty: 10 }),
        cand({ locationId: 'Y', shelfCode: 'A', shelfType: 'NORMAL', ageReference: ref, availableQty: 10 }),
        cand({ locationId: 'Z', shelfCode: 'B', shelfType: 'NORMAL', ageReference: ref, availableQty: 10 }),
      ],
      25,
      NOW
    );
    expect(out.suggestions.map((s) => s.shelfCode)).toEqual(['A', 'B', 'C']);
    expect(out.suggestions.map((s) => s.suggestedQty)).toEqual([10, 10, 5]);
  });

  it('boş ama önceliği değiştirmeyen edge: tek candidate az miktar', () => {
    const out = suggestPick(
      [cand({ locationId: 'A', ageReference: daysAgo(1), availableQty: 3 })],
      10,
      NOW
    );
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].suggestedQty).toBe(3);
    expect(out.remaining).toBe(7);
  });
});
