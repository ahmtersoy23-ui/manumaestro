/**
 * Çift sipariş kaydı guard'ı.
 *
 * Aynı fiziksel sipariş hem Wisersell otomatik (orderNumber = iç kod, ör. 51199;
 * channelOrderNumber = kanal no, ör. S_IWAUS22055) hem de manuel (orderNumber =
 * operatörün yazdığı kanal no, ör. S_IWAUS22055) olarak girilebiliyor. Marketplace
 * ve numara farklı olduğundan unique(warehouse,marketplace,orderNumber) yakalamaz.
 *
 * Bu helper kanal no üzerinden eşleşmeyi bulur → manuel girişte sert engel,
 * otomatik onayda atla. CANCELLED hariç açık/sevkli kayıtlara bakar.
 */

import { prisma } from '@/lib/db/prisma';

export interface DuplicateMatch {
  id: string;
  orderNumber: string;
  channelOrderNumber: string | null;
  marketplaceCode: string;
  warehouseCode: string;
  status: string;
  source: string;
  wisersellOrderId: number | null;
}

/** Verilen kanal/sipariş no'suyla eşleşen mevcut (iptal olmayan) bir sipariş var mı? */
export async function findChannelDuplicate(
  orderNumber: string,
  opts: { excludeWisersellOrderId?: number; excludeOrderId?: string } = {},
): Promise<DuplicateMatch | null> {
  const key = orderNumber.trim();
  if (!key) return null;
  const match = await prisma.outboundOrder.findFirst({
    where: {
      status: { not: 'CANCELLED' },
      OR: [{ channelOrderNumber: key }, { orderNumber: key }],
      ...(opts.excludeWisersellOrderId != null ? { wisersellOrderId: { not: opts.excludeWisersellOrderId } } : {}),
      ...(opts.excludeOrderId ? { id: { not: opts.excludeOrderId } } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      channelOrderNumber: true,
      marketplaceCode: true,
      warehouseCode: true,
      status: true,
      source: true,
      wisersellOrderId: true,
    },
  });
  return match as DuplicateMatch | null;
}

/** Operatöre gösterilecek açıklayıcı çift-kayıt mesajı. */
export function duplicateMessage(m: DuplicateMatch): string {
  const src = m.source === 'WISERSELL_AUTO' ? 'Wisersell otomatik' : 'manuel';
  const statusTr =
    m.status === 'DRAFT' ? 'Etiket Bekliyor' : m.status === 'SHIPPED' ? 'Sevk edildi' : m.status;
  const ws = m.wisersellOrderId ? `, Wisersell #${m.wisersellOrderId}` : '';
  return `Bu sipariş zaten kayıtlı (${src}, no: ${m.orderNumber}${ws}, durum: ${statusTr}). Çift kayıt engellendi — mevcut kaydı kullanın.`;
}
