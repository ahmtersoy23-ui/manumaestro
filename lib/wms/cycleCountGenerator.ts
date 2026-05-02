/**
 * Cycle count task generator.
 *
 * Verilen depo için:
 *   - Her aktif raf için, içindeki SKU'ların ABC sınıfını al
 *   - Rafın baskın sınıfı (en yüksek mevcut SKU) → frekans (A=30g, B=90g, C=180g)
 *   - Bu rafın son COMPLETED/DISCREPANCY task'ı eşik geçtiyse PENDING task yarat
 *   - Günlük max 5 task per depo (overflow ertelenir)
 *
 * Saf üretici: side-effect sadece DB INSERT.
 */

import { prisma } from '@/lib/db/prisma';
import {
  classifyAbc,
  toleranceForClass,
  frequencyDaysForClass,
  type AbcClass,
} from './abcClassify';

export interface GenerateResult {
  warehouseCode: string;
  evaluated: number;
  created: number;
  skipped: number;
  capped: boolean; // günlük cap'e ulaştı
}

const DAILY_CAP = 5;

function dominantClass(classes: AbcClass[]): AbcClass | null {
  if (classes.length === 0) return null;
  // En "kritik" sınıfı seç: A > B > C
  if (classes.includes('A')) return 'A';
  if (classes.includes('B')) return 'B';
  return 'C';
}

export async function generateCycleCountTasks(
  warehouseCode: string,
  now: Date = new Date()
): Promise<GenerateResult> {
  const abcMap = await classifyAbc(warehouseCode);

  const shelves = await prisma.shelf.findMany({
    where: { warehouseCode, isActive: true },
    select: {
      id: true,
      code: true,
      stocks: { select: { iwasku: true, quantity: true, reservedQty: true } },
      boxes: { select: { iwasku: true, quantity: true, reservedQty: true, status: true } },
    },
  });

  // Bugün açık (PENDING/IN_PROGRESS) task sayısı
  const openCount = await prisma.cycleCountTask.count({
    where: { warehouseCode, status: { in: ['PENDING', 'IN_PROGRESS'] } },
  });

  let created = 0;
  let skipped = 0;
  let evaluated = 0;
  const remainingCap = Math.max(0, DAILY_CAP - openCount);

  for (const shelf of shelves) {
    evaluated++;
    if (created >= remainingCap) {
      skipped++;
      continue;
    }

    // Boş rafları atla
    const hasContent =
      shelf.stocks.some((s) => s.quantity > 0) ||
      shelf.boxes.some((b) => b.quantity > 0 && b.status !== 'EMPTY');
    if (!hasContent) {
      skipped++;
      continue;
    }

    // Rafın SKU'larından ABC sınıflarını topla
    const skus = new Set<string>([
      ...shelf.stocks.map((s) => s.iwasku),
      ...shelf.boxes.map((b) => b.iwasku),
    ]);
    const classes: AbcClass[] = [];
    for (const sku of skus) {
      const c = abcMap.get(sku);
      if (c) classes.push(c);
    }
    const cls = dominantClass(classes);
    const freqDays = frequencyDaysForClass(cls);
    const tolerance = toleranceForClass(cls);
    const threshold = new Date(now.getTime() - freqDays * 86_400_000);

    // Bu rafın son tamamlanan/discrepancy task'ı eşikten yeni mi
    const lastCompleted = await prisma.cycleCountTask.findFirst({
      where: {
        shelfId: shelf.id,
        status: { in: ['COMPLETED', 'DISCREPANCY'] },
      },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });

    if (lastCompleted && lastCompleted.completedAt && lastCompleted.completedAt > threshold) {
      skipped++;
      continue;
    }

    // Açık task var mı (PENDING/IN_PROGRESS) — varsa atla
    const openExisting = await prisma.cycleCountTask.findFirst({
      where: {
        shelfId: shelf.id,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    if (openExisting) {
      skipped++;
      continue;
    }

    await prisma.cycleCountTask.create({
      data: {
        warehouseCode,
        shelfId: shelf.id,
        abcClass: cls,
        toleranceQty: tolerance,
        scheduledFor: now,
      },
    });
    created++;
  }

  return {
    warehouseCode,
    evaluated,
    created,
    skipped,
    capped: created >= remainingCap && created < shelves.length,
  };
}
