/**
 * StockPulse → ManuMaestro sync endpoint.
 * Service token ile yetkilendirilir (SSO YOK). Body toplu tavsiye listesi.
 *
 * 2026-05-28 revize: Suggestion ara aşaması KALDIRILDI.
 * Tavsiyeler direkt ProductionRequest olarak yazılır (entryType=STOCKPULSE).
 *
 * Upsert kuralı (iwasku × marketplaceId × productionMonth):
 *   - PR yok → yeni PR yarat (entryType=STOCKPULSE, status=REQUESTED, priority=MEDIUM)
 *   - PR var, entryType=STOCKPULSE → quantity güncelle (yeni tavsiyeyle override)
 *   - PR var, entryType=MANUAL/EXCEL → DOKUNMA (operatör manuel girmiş)
 *   - PR var, status=COMPLETED/CANCELLED → DOKUNMA (kapanmış)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ensureWarehouseProducts } from '@/lib/warehouse/ensureWarehouseProducts';
import { requireServiceToken } from '@/lib/auth/verify';
import { errorResponse, successResponse } from '@/lib/api/response';
import { createLogger } from '@/lib/logger';
import { revalidateTag } from 'next/cache';

const logger = createLogger('stockpulse-sync');

const ItemSchema = z.object({
  iwasku: z.string().min(1).max(50),
  marketplaceCode: z.string().min(1).max(50),
  productionMonth: z.string().regex(/^\d{4}-\d{2}$/),
  suggestedQty: z.number().int().nonnegative().max(999999),
  formulaVersion: z.string().min(1).max(20),
  reasoning: z.string().max(500).optional().nullable(),
  l30: z.number().int().nonnegative(),
  l90: z.number().int().nonnegative(),
  l180: z.number().int().nonnegative(),
  productName: z.string().min(1).max(200),
  productCategory: z.string().min(1).max(100),
  productSize: z.number().positive().optional().nullable(),
  recommendedDestination: z.string().max(10).optional().nullable(),
});

const PayloadSchema = z.object({
  suggestions: z.array(ItemSchema).min(0).max(5000),
});

const SYSTEM_USER_EMAIL = 'system@stockpulse';

async function getOrCreateSystemUser() {
  return prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: SYSTEM_USER_EMAIL,
      name: 'StockPulse System',
      passwordHash: 'SYSTEM_NO_LOGIN',
      role: 'ADMIN',
      isActive: true,
    },
    select: { id: true },
  });
}

export async function POST(request: NextRequest) {
  const auth = requireServiceToken(request);
  if ('ok' in auth === false) return auth;

  try {
    const body = await request.json();
    const validation = PayloadSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const { suggestions } = validation.data;
    if (suggestions.length === 0) {
      return successResponse({ processed: 0, created: 0, updated: 0, skipped: 0, unknownMarketplaces: [] });
    }

    const systemUser = await getOrCreateSystemUser();

    // marketplaceCode → marketplaceId resolve
    const codes = [...new Set(suggestions.map(s => s.marketplaceCode))];
    const marketplaces = await prisma.marketplace.findMany({
      where: { code: { in: codes }, isActive: true },
      select: { id: true, code: true },
    });
    const codeToId = new Map(marketplaces.map(m => [m.code, m.id]));
    const unknownMarketplaces = codes.filter(c => !codeToId.has(c));
    if (unknownMarketplaces.length > 0) {
      logger.warn('Bilinmeyen marketplace code(lar):', { codes: unknownMarketplaces });
    }

    const validRows = suggestions
      .map(s => {
        const mid = codeToId.get(s.marketplaceCode);
        if (!mid) return null;
        return { ...s, marketplaceId: mid };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let skipped = suggestions.length - validRows.length; // unknown marketplace
    const now = new Date();

    if (validRows.length > 0) {
      // Ankara depo SKU listesi: PR yaratılacak tüm iwasku'lar warehouse_products'a
      // ekle (yoksa). Snapshot regenerate olunca bu SKU'lar warehouseStock=0 olarak
      // görünür, "-" yerine. Depo operatörüne kolaylık.
      await ensureWarehouseProducts(validRows.map(s => s.iwasku));

      // Batch raw SQL: tek query'de tüm satırları INSERT ... ON CONFLICT.
      // Çakışma kuralı: entryType=STOCKPULSE ise quantity update, diğer (MANUAL/EXCEL/COMPLETED/CANCELLED) DOKUNMAZ.
      const CHUNK = 500;
      for (let i = 0; i < validRows.length; i += CHUNK) {
        const chunk = validRows.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const placeholders: string[] = [];

        chunk.forEach((s, idx) => {
          const base = idx * 13;
          const reasoningOrFormula = s.reasoning
            ? `${s.reasoning} · model=${s.formulaVersion} · L30=${s.l30}/L90=${s.l90}/L180=${s.l180}`
            : `model=${s.formulaVersion} · L30=${s.l30}/L90=${s.l90}/L180=${s.l180}`;
          placeholders.push(
            `(gen_random_uuid(), $${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, 'STOCKPULSE'::"EntryType", 'REQUESTED'::"RequestStatus", 'MEDIUM'::"RequestPriority", $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, $${base+13})`,
          );
          values.push(
            s.iwasku, s.productName, s.productCategory, s.productSize ?? null,
            s.marketplaceId, s.suggestedQty, s.productionMonth,
            reasoningOrFormula, // notes
            systemUser.id, // enteredById
            now, // requestDate
            now, // createdAt
            now, // updatedAt
            now, // sentAt? — production_requests'te sentAt yok, atla
          );
        });

        // Not: production_requests'te (iwasku, marketplaceId, productionMonth) UNIQUE index yok.
        // findFirst + update/create pattern yerine WHERE NOT EXISTS pattern kullan.
        // Bu kompleks. Daha sade: per-row findFirst + update veya create.
      }

      // Per-row upsert (UNIQUE index yok, raw batch zor). Volume max 5000 — kabul edilebilir.
      // Performans: 245 satır için ~3-5sn. Production sınırı 30sn timeout içinde.
      for (const s of validRows) {
        const reasoningStr = s.reasoning
          ? `${s.reasoning} · model=${s.formulaVersion} · L30=${s.l30}/L90=${s.l90}/L180=${s.l180}`
          : `model=${s.formulaVersion} · L30=${s.l30}/L90=${s.l90}/L180=${s.l180}`;

        const existing = await prisma.productionRequest.findFirst({
          where: {
            iwasku: s.iwasku,
            marketplaceId: s.marketplaceId,
            productionMonth: s.productionMonth,
          },
          select: { id: true, entryType: true, status: true, quantity: true, recommendedDestination: true },
        });

        if (!existing) {
          if (s.suggestedQty === 0) {
            // Yeni kayıt + qty=0: yaratma. Sezonsal/durdurulan SKU'lar.
            skipped++;
            continue;
          }
          await prisma.productionRequest.create({
            data: {
              iwasku: s.iwasku,
              productName: s.productName,
              productCategory: s.productCategory,
              productSize: s.productSize ?? null,
              marketplaceId: s.marketplaceId,
              quantity: s.suggestedQty,
              productionMonth: s.productionMonth,
              entryType: 'STOCKPULSE',
              status: 'REQUESTED',
              priority: 'MEDIUM',
              notes: reasoningStr,
              recommendedDestination: s.recommendedDestination ?? null,
              enteredById: systemUser.id,
            },
          });
          created++;
        } else if (existing.entryType !== 'STOCKPULSE') {
          // Operatör manuel veya excel girmiş — dokunma (qty=0 dahil)
          skipped++;
        } else if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
          // Kapatılmış PR — dokunma
          skipped++;
        } else if (s.suggestedQty === 0) {
          // STOCKPULSE + qty=0: sezonsal/durdurulmuş SKU → eski PR'ı SİL.
          // Operatör listede görmesin; gelecek sync planned_qty>0 olursa yeniden yaratılır.
          await prisma.productionRequest.delete({ where: { id: existing.id } });
          deleted++;
        } else {
          // STOCKPULSE varlığı güncelle (qty veya destinasyon değiştiyse)
          const newDest = s.recommendedDestination ?? null;
          if (existing.quantity !== s.suggestedQty || existing.recommendedDestination !== newDest) {
            await prisma.productionRequest.update({
              where: { id: existing.id },
              data: {
                quantity: s.suggestedQty,
                notes: reasoningStr,
                productName: s.productName,
                productCategory: s.productCategory,
                productSize: s.productSize ?? null,
                recommendedDestination: newDest,
              },
            });
            updated++;
          } else {
            skipped++; // değişiklik yok
          }
        }
      }
    }

    revalidateTag('dashboard-stats', 'default');

    logger.info('StockPulse sync tamamlandı', {
      processed: suggestions.length, created, updated, deleted, skipped, unknownMarketplaces,
    });

    return successResponse({
      processed: suggestions.length,
      created,
      updated,
      deleted,
      skipped,
      unknownMarketplaces,
    });
  } catch (err) {
    return errorResponse(err, 'StockPulse sync hatası');
  }
}
