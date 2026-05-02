/**
 * POST /api/depolar/[code]/sayim/generate
 *   Manuel olarak cycle count task'ları üret (manager+).
 *   Cron sonra entegre edilecek.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { generateCycleCountTasks } from '@/lib/wms/cycleCountGenerator';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'cycleCountGenerate');
  if (auth instanceof NextResponse) return auth;

  const result = await generateCycleCountTasks(upperCode);
  return NextResponse.json({ success: true, data: result });
}
