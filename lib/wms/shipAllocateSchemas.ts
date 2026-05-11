import { z } from 'zod';

/**
 * SINGLE outbound siparişin SHIPPED'a geçişi için allocation payload şeması.
 * Route handler ve client formu tek truth source kullansın diye burada.
 */
export const PickSchema = z
  .object({
    source: z.enum(['STOCK', 'BOX']),
    shelfId: z.string().trim().optional(),
    shelfStockId: z.string().trim().optional(),
    shelfBoxId: z.string().trim().optional(),
    qty: z.number().int().positive().max(100000),
  })
  .refine(
    (p) =>
      (p.source === 'STOCK' && !!p.shelfStockId && !!p.shelfId) ||
      (p.source === 'BOX' && !!p.shelfBoxId),
    { message: 'STOCK için shelfStockId+shelfId, BOX için shelfBoxId zorunlu' }
  );

export const AllocationSchema = z.object({
  itemId: z.string().trim().min(1),
  picks: z.array(PickSchema).min(1).max(20),
});

export const ShipAllocateSchema = z.object({
  allocations: z.array(AllocationSchema).min(1).max(50),
});

export type ShipAllocatePayload = z.infer<typeof ShipAllocateSchema>;
export type Pick = z.infer<typeof PickSchema>;
export type Allocation = z.infer<typeof AllocationSchema>;

/**
 * Allocation toplamı sipariş kalemi miktarına eşit mi?
 * Pure helper — route handler'ında transaction içinde kullanılan invariant.
 */
export function pickSum(picks: Pick[]): number {
  return picks.reduce((s, p) => s + p.qty, 0);
}

/**
 * Tüm sipariş kalemlerinin allocation'ı tam karşıladığını doğrular.
 * Hata varsa Türkçe mesaj döndürür; hata yoksa null.
 */
export function validateAllocationsCoverage(
  allocations: Allocation[],
  items: { id: string; iwasku: string; quantity: number }[]
): string | null {
  const itemMap = new Map(items.map((i) => [i.id, i]));

  for (const a of allocations) {
    const item = itemMap.get(a.itemId);
    if (!item) return `Sipariş kalemi bulunamadı: ${a.itemId}`;
    const sum = pickSum(a.picks);
    if (sum !== item.quantity) {
      return `${item.iwasku}: ${item.quantity} adet bekleniyor, ${sum} adet seçilmiş`;
    }
  }

  const allocatedItemIds = new Set(allocations.map((a) => a.itemId));
  for (const item of items) {
    if (!allocatedItemIds.has(item.id)) {
      return `${item.iwasku}: raf seçimi eksik`;
    }
  }

  return null;
}
