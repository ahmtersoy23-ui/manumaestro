/**
 * StockPulse → ManuMaestro üretim önerisi sync endpoint.
 * Service token ile yetkilendirilir (SSO YOK). Body toplu öneri listesi.
 *
 * Upsert kuralı:
 *   - PENDING varsa suggestedQty + meta üzerine yazılır (her gün güncel öneri)
 *   - ACCEPTED / DISMISSED varsa dokunulmaz (operatör kararı korunur)
 *   - EXPIRED varsa PENDING'e geri çekilir (operatöre tekrar sunulur)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireServiceToken } from '@/lib/auth/verify';
import { errorResponse, successResponse } from '@/lib/api/response';
import { createLogger } from '@/lib/logger';

const logger = createLogger('production-suggestions/sync');

const SuggestionItemSchema = z.object({
  iwasku: z.string().min(1).max(50),
  marketplaceCode: z.string().min(1).max(50),
  productionMonth: z.string().regex(/^\d{4}-\d{2}$/),
  suggestedQty: z.number().int().positive().max(999999),
  formulaVersion: z.string().min(1).max(20),
  reasoning: z.string().max(500).optional().nullable(),
  l30: z.number().int().nonnegative(),
  l90: z.number().int().nonnegative(),
  l180: z.number().int().nonnegative(),
  productName: z.string().min(1).max(200),
  productCategory: z.string().min(1).max(100),
  productSize: z.number().positive().optional().nullable(),
});

const SyncPayloadSchema = z.object({
  suggestions: z.array(SuggestionItemSchema).min(0).max(5000),
});

export async function POST(request: NextRequest) {
  const auth = requireServiceToken(request);
  if ('ok' in auth === false) return auth;

  try {
    const body = await request.json();
    const validation = SyncPayloadSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const { suggestions } = validation.data;

    // Sync'te otomatik expire: 30+ gün karar verilmemiş PENDING -> EXPIRED.
    // Ayrı cron yerine günlük sync ile birlikte yürür.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const expireResult = await prisma.productionSuggestion.updateMany({
      where: { status: 'PENDING', syncedAt: { lt: thirtyDaysAgo } },
      data: { status: 'EXPIRED' },
    });

    if (suggestions.length === 0) {
      return successResponse({
        processed: 0, created: 0, updated: 0, skipped: 0,
        expired: expireResult.count, unknownMarketplaces: [],
      });
    }

    // marketplaceCode → marketplaceId resolve (tek seferlik query)
    const codes = [...new Set(suggestions.map(s => s.marketplaceCode))];
    const marketplaces = await prisma.marketplace.findMany({
      where: { code: { in: codes }, isActive: true },
      select: { id: true, code: true },
    });
    const codeToId = new Map(marketplaces.map(m => [m.code, m.id]));
    const unknownMarketplaces = codes.filter(c => !codeToId.has(c));

    if (unknownMarketplaces.length > 0) {
      logger.warn('Bilinmeyen marketplace code(lar):', { codes: unknownMarketplaces });
      // Slack alarmı opsiyonel — şimdilik log + response'da geri döndür
    }

    let skipped = 0;
    const now = new Date();

    // Batch upsert — raw SQL ON CONFLICT. 248 satır için per-row prisma 30sn+
    // sürer; tek query ile <1sn. ACCEPTED/DISMISSED satırlara dokunma (WHERE).
    const validRows = suggestions
      .map(s => {
        const mid = codeToId.get(s.marketplaceCode);
        if (!mid) { skipped++; return null; }
        return { ...s, marketplaceId: mid };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let created = 0, updated = 0;
    if (validRows.length > 0) {
      // 500'lük chunk'larla işle (PostgreSQL parametre limiti 65535'e karşı margin)
      const CHUNK = 500;
      for (let i = 0; i < validRows.length; i += CHUNK) {
        const chunk = validRows.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        chunk.forEach((s, idx) => {
          const base = idx * 13;
          placeholders.push(
            `(gen_random_uuid(), $${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, 'PENDING'::"SuggestionStatus", $${base+13})`,
          );
          values.push(
            s.iwasku, s.productName, s.productCategory, s.productSize ?? null,
            s.marketplaceId, s.productionMonth, s.suggestedQty, s.formulaVersion,
            s.reasoning ?? null, s.l30, s.l90, s.l180, now,
          );
        });

        const sql = `
          WITH inserted AS (
            INSERT INTO production_suggestions
              (id, iwasku, "productName", "productCategory", "productSize",
               "marketplaceId", "productionMonth", "suggestedQty", "formulaVersion",
               reasoning, l30, l90, l180, status, "syncedAt")
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (iwasku, "marketplaceId", "productionMonth")
            DO UPDATE SET
              "suggestedQty"    = EXCLUDED."suggestedQty",
              "formulaVersion"  = EXCLUDED."formulaVersion",
              reasoning         = EXCLUDED.reasoning,
              l30               = EXCLUDED.l30,
              l90               = EXCLUDED.l90,
              l180              = EXCLUDED.l180,
              "productName"     = EXCLUDED."productName",
              "productCategory" = EXCLUDED."productCategory",
              "productSize"     = EXCLUDED."productSize",
              status            = 'PENDING'::"SuggestionStatus",
              "syncedAt"        = EXCLUDED."syncedAt",
              "decidedAt"       = NULL,
              "decidedById"     = NULL
            WHERE production_suggestions.status NOT IN ('ACCEPTED', 'DISMISSED')
            RETURNING (xmax = 0) AS inserted
          )
          SELECT
            COUNT(*) FILTER (WHERE inserted)       AS created,
            COUNT(*) FILTER (WHERE NOT inserted)   AS updated
          FROM inserted
        `;

        const result = await prisma.$queryRawUnsafe<{ created: bigint; updated: bigint }[]>(sql, ...values);
        created += Number(result[0]?.created ?? 0);
        updated += Number(result[0]?.updated ?? 0);
      }
      // ACCEPTED/DISMISSED satırlar WHERE ile atlandı; toplamla tutarlı sayım için skipped'a ekle
      skipped += validRows.length - created - updated;
    }

    logger.info('Sync tamamlandı', {
      processed: suggestions.length, created, updated, skipped,
      expired: expireResult.count, unknownMarketplaces,
    });

    return successResponse({
      processed: suggestions.length,
      created,
      updated,
      skipped,
      expired: expireResult.count,
      unknownMarketplaces,
    });
  } catch (err) {
    return errorResponse(err, 'Öneri sync hatası');
  }
}
