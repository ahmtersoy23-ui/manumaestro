import { describe, expect, it } from 'vitest';
import { resolveOutboundWarehouse, outboundBlockMessage } from '@/lib/wms/usWarehouseStock';

describe('resolveOutboundWarehouse — Fairfield (SHOWROOM) önceliği', () => {
  it('iki depoda da stok yoksa correct null', () => {
    expect(resolveOutboundWarehouse({ NJ: 0, SHOWROOM: 0 }, 5)).toEqual({
      correct: null,
      sufficient: false,
    });
  });

  it('Fairfield istenen adedi karşılıyorsa Fairfield (öncelik)', () => {
    // Somerset daha çok olsa bile Fairfield yeterliyse Fairfield seçilir
    expect(resolveOutboundWarehouse({ NJ: 100, SHOWROOM: 10 }, 10)).toEqual({
      correct: 'SHOWROOM',
      sufficient: true,
    });
  });

  it('Fairfield yetmiyor ama Somerset yetiyorsa Somerset', () => {
    expect(resolveOutboundWarehouse({ NJ: 20, SHOWROOM: 3 }, 10)).toEqual({
      correct: 'NJ',
      sufficient: true,
    });
  });

  it('ikisi de tek başına yetmiyorsa en çok stoğu olan + sufficient=false', () => {
    expect(resolveOutboundWarehouse({ NJ: 7, SHOWROOM: 3 }, 10)).toEqual({
      correct: 'NJ',
      sufficient: false,
    });
    expect(resolveOutboundWarehouse({ NJ: 3, SHOWROOM: 7 }, 10)).toEqual({
      correct: 'SHOWROOM',
      sufficient: false,
    });
  });

  it('ikisi de yetmiyor ve eşitse Fairfield (öncelik)', () => {
    expect(resolveOutboundWarehouse({ NJ: 5, SHOWROOM: 5 }, 10)).toEqual({
      correct: 'SHOWROOM',
      sufficient: false,
    });
  });
});

describe('outboundBlockMessage', () => {
  it('doğru depoya (Fairfield, yeterli) giriş serbest → null', () => {
    expect(outboundBlockMessage('SHOWROOM', 'X1', 5, { NJ: 0, SHOWROOM: 10 })).toBeNull();
  });

  it('Somerset-only ürün Somerset deposuna girilebilir → null', () => {
    expect(outboundBlockMessage('NJ', 'X1', 5, { NJ: 10, SHOWROOM: 0 })).toBeNull();
  });

  it('Fairfield öncelikli ürün Somerset deposuna girilemez → blok + Fairfield yönlendirme', () => {
    const msg = outboundBlockMessage('NJ', 'X1', 5, { NJ: 100, SHOWROOM: 10 });
    expect(msg).toContain('Fairfield');
    expect(msg).toContain('X1');
  });

  it('Fairfield deposuna girildi ama stok Somerset’te → blok + Somerset yönlendirme', () => {
    const msg = outboundBlockMessage('SHOWROOM', 'X1', 5, { NJ: 10, SHOWROOM: 0 });
    expect(msg).toContain('Somerset');
  });

  it('hiçbir US deposunda yoksa hedef ne olursa olsun blok', () => {
    expect(outboundBlockMessage('NJ', 'X1', 5, { NJ: 0, SHOWROOM: 0 })).toContain('Hiçbir');
    expect(outboundBlockMessage('SHOWROOM', 'X1', 5, { NJ: 0, SHOWROOM: 0 })).toContain('Hiçbir');
  });

  it('yetersiz ama doğru (en çok stoklu) depoya giriş serbest → null', () => {
    // Fairfield 7, Somerset 3, qty 10 → correct SHOWROOM, yetersiz ama izinli
    expect(outboundBlockMessage('SHOWROOM', 'X1', 10, { NJ: 3, SHOWROOM: 7 })).toBeNull();
  });
});
