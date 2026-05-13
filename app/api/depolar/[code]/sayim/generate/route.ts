/**
 * POST /api/depolar/[code]/sayim/generate
 *   Manuel olarak cycle count task'ları üret (manager+).
 *   Cron sonra entegre edilecek.
 */

import { NextResponse } from 'next/server';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { generateCycleCountTasks } from '@/lib/wms/cycleCountGenerator';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const POST = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sayım üretilemedi' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'cycleCountGenerate');
    if (auth instanceof NextResponse) return auth;

    const result = await generateCycleCountTasks(upperCode);
    return successResponse(result);
  }
);
