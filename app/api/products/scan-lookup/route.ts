/**
 * GET /api/products/scan-lookup?code=...
 * Taranan/girilen kodu tek bir IWASKU'ya çevirir (FNSKU → IWASKU fallback).
 * 200: { data: { iwasku, name, category, foundBy, fnsku } }
 * 404: { success: false, error: '...' }
 */

import { NextResponse } from 'next/server';
import { lookupByScan } from '@/lib/products/scanLookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Tarama eşleşmesi başarısız' },
  async ({ request }) => {
    const code = request.nextUrl.searchParams.get('code')?.trim() ?? '';
    if (code.length < 3) {
      return NextResponse.json(
        { success: false, error: 'En az 3 karakter gerekli' },
        { status: 400 },
      );
    }

    const result = await lookupByScan(code);
    if (!result) {
      return NextResponse.json(
        { success: false, error: `Eşleşme yok: ${code}` },
        { status: 404 },
      );
    }

    return successResponse(result);
  },
);
