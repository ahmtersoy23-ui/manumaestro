/**
 * POST /api/siparis/auto-run?region=US
 *
 * WISERSELL_AUTO_APPROVE=true iken stok-teyitli tüm adayları insan onayı olmadan onaylar
 * (OutboundOrder + Kargoya Hazır). İlk denemelerde flag false → no-op. Güven sonrası true.
 * Süper-admin (manuel "Tümünü Onayla") veya ileride sunucu cron (service token) tetikleyebilir.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { approveWisersellCandidates, getEligibleCandidateIds } from '@/lib/wisersell/approve';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisAutoRun');

function autoApproveEnabled(): boolean {
  return (process.env.WISERSELL_AUTO_APPROVE || '').toLowerCase() === 'true';
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

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

  const results = await approveWisersellCandidates(ids, auth.user.id);
  const approved = results.filter((r) => r.status === 'approved').length;
  logger.info(`auto-run (${region}): ${approved}/${ids.length} otomatik onaylandı`);
  return NextResponse.json({ success: true, approved, results });
}
