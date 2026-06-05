/**
 * GET /api/depolar/[code]/siparis/stock-check?iwasku=X
 * Bir iwasku'nun US depolarındaki (Somerset=NJ + Fairfield=SHOWROOM) kullanılabilir
 * stoğunu döner. Yeni sipariş formunda satır bazlı canlı kontrol için kullanılır.
 *
 * Sevk kuralının kendisi (hangi depo doğru) backend create endpoint'inde
 * zorlanır; bu endpoint sadece adetleri verir, frontend ikaz/blok rozetini hesaplar.
 */

import { NextResponse } from 'next/server';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getUsAvailability } from '@/lib/wms/usWarehouseStock';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Stok kontrolü alınamadı' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const sp = new URL(request.url).searchParams;
    const iwasku = sp.get('iwasku')?.trim();
    const excludeOrderId = sp.get('excludeOrderId')?.trim() || undefined;
    if (!iwasku) {
      return NextResponse.json({ success: false, error: 'iwasku gerekli' }, { status: 400 });
    }

    // Bekleyen DRAFT miktarları düşülür (yumuşak rezerve); edit modunda kendi sipariş hariç.
    const [avail, productMap] = await Promise.all([
      getUsAvailability([iwasku], { subtractPendingDraft: true, excludeOrderId }),
      getProductsByIwasku([iwasku]),
    ]);
    const a = avail.get(iwasku) ?? { NJ: 0, SHOWROOM: 0 };
    const fnsku = productMap.get(iwasku)?.fnsku ?? null;

    return successResponse({ iwasku, NJ: a.NJ, SHOWROOM: a.SHOWROOM, fnsku });
  }
);
