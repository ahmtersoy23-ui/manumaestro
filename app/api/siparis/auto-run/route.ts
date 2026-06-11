/**
 * POST /api/siparis/auto-run?region=US
 *
 * WISERSELL_AUTO_APPROVE=true iken stok-teyitli, manuel-onay gerektirmeyen (Mobilya /
 * Amazon Citi / Etsy HARİÇ) tüm adayları insan onayı olmadan onaylar (OutboundOrder +
 * Kargoya Hazır). İki tetikleyici:
 *  - UI "Tümünü Onayla": APPROVER yetkisi.
 *  - Sunucu cron (5 dk): x-internal-api-key (SSO-muaf, createdById='system-auto').
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { approveWisersellCandidates, getEligibleCandidateIds } from '@/lib/wisersell/approve';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisAutoRun');

const CRON_USER_ID = 'system-auto'; // createdById (OutboundOrder→User FK YOK, düz string)

function autoApproveEnabled(): boolean {
  return (process.env.WISERSELL_AUTO_APPROVE || '').toLowerCase() === 'true';
}

export async function POST(request: NextRequest) {
  // Cron yolu: x-internal-api-key; aksi halde UI: APPROVER yetkisi.
  const key = request.headers.get('x-internal-api-key');
  const isCron = !!process.env.MANU_INTERNAL_API_KEY && key === process.env.MANU_INTERNAL_API_KEY;
  let userId: string;
  if (isCron) {
    userId = CRON_USER_ID;
  } else {
    const auth = await requireOrderBoardLevel(request, 'APPROVER');
    if (auth instanceof NextResponse) return auth;
    userId = auth.user.id;
  }

  if (!autoApproveEnabled()) {
    return NextResponse.json(
      { success: false, error: 'Otomatik onay kapalı (WISERSELL_AUTO_APPROVE=false). İlk dönem manuel onay.' },
      { status: 409 },
    );
  }

  const region = new URL(request.url).searchParams.get('region') || 'US';
  const ids = await getEligibleCandidateIds(region);
  if (!ids.length) {
    return NextResponse.json({ success: true, approved: 0, results: [], message: 'Onaya hazır aday yok' });
  }

  const results = await approveWisersellCandidates(ids, userId);
  const approved = results.filter((r) => r.status === 'approved').length;
  logger.info(`auto-run (${region}, ${isCron ? 'cron' : 'ui'}): ${approved}/${ids.length} otomatik onaylandı`);
  return NextResponse.json({ success: true, approved, results });
}
