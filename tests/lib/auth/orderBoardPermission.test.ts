import { describe, it, expect } from 'vitest';
import { hasOrderLevel } from '@/lib/auth/orderBoardPermission';

describe('hasOrderLevel — sipariş board kademeli yetki (kümülatif)', () => {
  it('NONE hiçbir aksiyonu karşılamaz (görüntüleme dışı)', () => {
    expect(hasOrderLevel('NONE', 'APPROVER')).toBe(false);
    expect(hasOrderLevel('NONE', 'CREATOR')).toBe(false);
    expect(hasOrderLevel('NONE', 'FULL')).toBe(false);
  });

  it('APPROVER yalnız onay kademesini karşılar', () => {
    expect(hasOrderLevel('APPROVER', 'APPROVER')).toBe(true);
    expect(hasOrderLevel('APPROVER', 'CREATOR')).toBe(false);
    expect(hasOrderLevel('APPROVER', 'FULL')).toBe(false);
  });

  it('CREATOR onay + manuel giriş kademesini karşılar, etiket/sil hayır', () => {
    expect(hasOrderLevel('CREATOR', 'APPROVER')).toBe(true);
    expect(hasOrderLevel('CREATOR', 'CREATOR')).toBe(true);
    expect(hasOrderLevel('CREATOR', 'FULL')).toBe(false);
  });

  it('FULL tüm kademeleri karşılar', () => {
    expect(hasOrderLevel('FULL', 'APPROVER')).toBe(true);
    expect(hasOrderLevel('FULL', 'CREATOR')).toBe(true);
    expect(hasOrderLevel('FULL', 'FULL')).toBe(true);
  });
});
