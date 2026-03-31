/**
 * One-time fix: Consolidate distributed producedQuantity to first request per iwasku
 * Then trigger waterfall for all affected products
 *
 * Run: npx tsx scripts/fix-distributed-production.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const month = '2026-04';

  // 1. Find iwaskus with distributed producedQuantity (multiple requests > 0)
  const distributed = await prisma.$queryRaw<{ iwasku: string; total: number }[]>`
    SELECT iwasku, SUM("producedQuantity") as total
    FROM production_requests
    WHERE "productionMonth" = ${month} AND "producedQuantity" > 0
    GROUP BY iwasku
    HAVING COUNT(*) > 1
  `;

  console.log(`${distributed.length} ürün düzeltilecek:\n`);

  for (const { iwasku, total } of distributed) {
    // Get all requests for this iwasku, ordered by createdAt
    const requests = await prisma.productionRequest.findMany({
      where: { iwasku, productionMonth: month },
      orderBy: { createdAt: 'asc' },
      select: { id: true, producedQuantity: true },
    });

    const firstId = requests[0]?.id;
    if (!firstId) continue;

    // Set first request to total, others to 0
    await prisma.productionRequest.update({
      where: { id: firstId },
      data: { producedQuantity: Number(total) },
    });

    const otherIds = requests.filter(r => r.id !== firstId).map(r => r.id);
    if (otherIds.length > 0) {
      await prisma.productionRequest.updateMany({
        where: { id: { in: otherIds }, producedQuantity: { gt: 0 } },
        data: { producedQuantity: 0 },
      });
    }

    console.log(`  ${iwasku}: ${total} → first request, ${otherIds.length} others zeroed`);
  }

  // 2. Trigger waterfall for all iwaskus in this month
  // Import dynamically to avoid module resolution issues
  const { waterfallComplete } = await import('../lib/waterfallComplete');

  const allIwaskus = await prisma.productionRequest.findMany({
    where: { productionMonth: month },
    select: { iwasku: true },
    distinct: ['iwasku'],
  });

  console.log(`\nWaterfall çalıştırılıyor: ${allIwaskus.length} ürün...`);

  let totalChanged = 0;
  for (const { iwasku } of allIwaskus) {
    const changed = await waterfallComplete(iwasku, month);
    if (changed > 0) {
      console.log(`  ${iwasku}: ${changed} talep güncellendi`);
      totalChanged += changed;
    }
  }

  console.log(`\nTamamlandı: ${distributed.length} ürün düzeltildi, ${totalChanged} talep waterfall ile güncellendi`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
