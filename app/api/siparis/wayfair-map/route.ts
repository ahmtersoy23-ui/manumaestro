/**
 * POST /api/siparis/wayfair-map  { partNumber, iwasku }
 *
 * CG export'unda eşleşmeyen iwasku için operatörün girdiği Wayfair part number mapping'ini
 * DataBridge'e (wayfair_sku_mapping upsert + inventory.iwasku update + aggregation refresh) yazar.
 * Yetki: Manager+.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { saveWayfairMapping } from '@/lib/wisersell/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisWayfairMap');

const Schema = z.object({
  partNumber: z.string().trim().min(1).max(100),
  iwasku: z.string().trim().min(1).max(50),
});

export async function POST(request: NextRequest) {
  const auth = await requireBoardManager(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { partNumber, iwasku } = parsed.data;

  try {
    await saveWayfairMapping(partNumber, iwasku);
    logger.info(`wayfair-map: ${partNumber} → ${iwasku} (${auth.user.email})`);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 502 });
  }
}
