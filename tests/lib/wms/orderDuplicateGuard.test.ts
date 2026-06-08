import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { outboundOrder: { findFirst: vi.fn() } },
}));

import { prisma } from '@/lib/db/prisma';
import { findChannelDuplicate, duplicateMessage } from '@/lib/wms/orderDuplicateGuard';

const findFirst = vi.mocked(prisma.outboundOrder.findFirst);

const autoMatch = {
  id: 'o1',
  orderNumber: '51199',
  channelOrderNumber: 'S_IWAUS22055',
  marketplaceCode: 'S_IWAUS',
  warehouseCode: 'SHOWROOM',
  status: 'DRAFT',
  source: 'WISERSELL_AUTO',
  wisersellOrderId: 299883,
};

describe('findChannelDuplicate', () => {
  beforeEach(() => findFirst.mockReset());

  it('boş/whitespace no için sorgu atmaz, null döner', async () => {
    expect(await findChannelDuplicate('   ')).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('kanal no veya orderNumber eşleşmesini iptal olmayanlar arasında arar', async () => {
    findFirst.mockResolvedValue(autoMatch as never);
    const m = await findChannelDuplicate('S_IWAUS22055');
    expect(m).toEqual(autoMatch);
    const where = findFirst.mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.status).toEqual({ not: 'CANCELLED' });
    expect(where.OR).toEqual([{ channelOrderNumber: 'S_IWAUS22055' }, { orderNumber: 'S_IWAUS22055' }]);
  });

  it('excludeWisersellOrderId verilince kendi kaydını hariç tutar', async () => {
    findFirst.mockResolvedValue(null);
    await findChannelDuplicate('S_IWAUS22055', { excludeWisersellOrderId: 299883 });
    const where = findFirst.mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.wisersellOrderId).toEqual({ not: 299883 });
  });

  it('eşleşme yoksa null döner', async () => {
    findFirst.mockResolvedValue(null);
    expect(await findChannelDuplicate('YOK-123')).toBeNull();
  });
});

describe('duplicateMessage', () => {
  it('Wisersell otomatik DRAFT kaydı için açıklayıcı mesaj üretir', () => {
    const msg = duplicateMessage(autoMatch);
    expect(msg).toContain('Wisersell otomatik');
    expect(msg).toContain('51199');
    expect(msg).toContain('Wisersell #299883');
    expect(msg).toContain('Etiket Bekliyor');
  });

  it('manuel sevk edilmiş kayıt için kaynak ve durum çevirir', () => {
    const msg = duplicateMessage({ ...autoMatch, source: 'MANUAL', status: 'SHIPPED', wisersellOrderId: null });
    expect(msg).toContain('manuel');
    expect(msg).toContain('Sevk edildi');
    expect(msg).not.toContain('Wisersell #');
  });
});
