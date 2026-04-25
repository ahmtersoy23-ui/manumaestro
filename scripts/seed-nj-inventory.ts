/**
 * One-time seed: NJ deposunun mevcut envanterini CSV'den yükle.
 *
 * Girdi: ~/Desktop/warehouse-inventory-2026-04-24.csv (env override: SEED_CSV_PATH)
 * Kolonlar: fnsku, description, koli, raf, amount
 *
 * Yapacakları:
 *   1. Warehouse upsert: ANKARA, NJ, SHOWROOM
 *   2. NJ POOL rafı upsert
 *   3. CSV'deki unique raf kodlarını NJ Shelf olarak upsert
 *   4. fnsku → iwasku lookup (pricelab_db.sku_master)
 *   5. Her CSV satırı:
 *        - koli boş  → ShelfStock (warehouseCode=NJ, shelfId, iwasku, quantity)
 *        - koli dolu → ShelfBox (boxNumber=koli, shipmentBoxId boxNumber match'lenirse set edilir)
 *   6. Her giriş için ShelfMovement(INBOUND_MANUAL, refType='SEED') log
 *
 * Idempotent: aynı (shelfId, iwasku) → quantity ÜZERİNE YAZAR; aynı boxNumber → SKIP eder.
 *
 * Çalıştırma:  npx tsx scripts/seed-nj-inventory.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const DEFAULT_CSV = path.join(os.homedir(), 'Desktop', 'warehouse-inventory-2026-04-24.csv');
const CSV_PATH = process.env.SEED_CSV_PATH || DEFAULT_CSV;
const SEED_USER_ID = process.env.SEED_USER_ID; // ShelfMovement.userId için bir admin user.id

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const productPool = new Pool({ connectionString: process.env.PRODUCT_DB_URL });

type Row = { fnsku: string; description: string; koli: string; raf: string; amount: number };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"' && cur === '') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

function readCsv(filePath: string): Row[] {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV boş veya başlıksız');

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 5) {
      console.warn(`[CSV row ${i + 1}] kolon sayısı az (${cols.length}), atlanıyor: ${lines[i]}`);
      continue;
    }
    const [fnsku, description, koli, raf, amountStr] = cols;
    const amount = Number(amountStr.trim());
    if (!fnsku.trim() || !raf.trim() || !Number.isFinite(amount) || amount <= 0) {
      console.warn(`[CSV row ${i + 1}] geçersiz, atlanıyor: ${lines[i]}`);
      continue;
    }
    rows.push({
      fnsku: fnsku.trim(),
      description: description.trim(),
      koli: koli.trim(),
      raf: raf.trim(),
      amount,
    });
  }
  return rows;
}

type SkuMasterCol = 'fnsku' | 'asin' | 'iwasku' | 'sku';
type ResolveSource = SkuMasterCol | 'products';
type ResolveResult = { iwasku: string; via: ResolveSource };

/**
 * CSV "fnsku" kolonu çoğu zaman gerçek FNSKU; ama bazen:
 *   - Amazon ASIN (örn. B0B3Y9MMCP)
 *   - Doğrudan iwasku (örn. IA147001MWFK)
 *   - Merchant SKU (sku_master.sku)
 *   - products.product_sku — ana iwasku tablosu, henüz pazaryerinde listelenmemiş ürünler için
 *
 * Lookup sırası: sku_master(fnsku → asin → iwasku → sku) → products.product_sku
 */
async function resolveLookupValues(values: string[]): Promise<Map<string, ResolveResult>> {
  const map = new Map<string, ResolveResult>();
  if (values.length === 0) return map;

  const remaining = new Set(values);
  const client = await productPool.connect();
  try {
    const tryColumn = async (col: SkuMasterCol) => {
      if (remaining.size === 0) return;
      const arr = Array.from(remaining);
      const result = await client.query<{ key: string; iwasku: string }>(
        `SELECT DISTINCT ${col} AS key, iwasku
         FROM sku_master
         WHERE ${col} = ANY($1::text[]) AND ${col} IS NOT NULL AND iwasku IS NOT NULL`,
        [arr]
      );
      for (const r of result.rows) {
        if (!remaining.has(r.key)) continue;
        const existing = map.get(r.key);
        if (!existing) {
          map.set(r.key, { iwasku: r.iwasku, via: col });
        } else if (existing.iwasku !== r.iwasku) {
          console.warn(`[${col} ambigu] ${r.key} → ${existing.iwasku} ve ${r.iwasku}; ilk kullanılıyor`);
        }
      }
      for (const k of map.keys()) remaining.delete(k);
    };

    const tryProductsTable = async () => {
      if (remaining.size === 0) return;
      const arr = Array.from(remaining);
      // products.product_sku KENDİSİ iwasku — pazaryerinde olmayan ürünler de burada bulunur
      const result = await client.query<{ key: string }>(
        `SELECT DISTINCT product_sku AS key
         FROM products
         WHERE product_sku = ANY($1::text[]) AND product_sku IS NOT NULL`,
        [arr]
      );
      for (const r of result.rows) {
        if (!remaining.has(r.key)) continue;
        map.set(r.key, { iwasku: r.key, via: 'products' });
        remaining.delete(r.key);
      }
    };

    await tryColumn('fnsku');
    await tryColumn('asin');
    await tryColumn('iwasku');
    await tryColumn('sku');
    await tryProductsTable();
  } finally {
    client.release();
  }
  return map;
}

async function ensureWarehouses() {
  await prisma.warehouse.upsert({
    where: { code: 'ANKARA' },
    update: {},
    create: { code: 'ANKARA', name: 'Ankara Depo', region: 'TR', stockMode: 'TOTALS_PRIMARY' },
  });
  await prisma.warehouse.upsert({
    where: { code: 'NJ' },
    update: {},
    create: { code: 'NJ', name: 'New Jersey Depo', region: 'US', stockMode: 'SHELF_PRIMARY' },
  });
  await prisma.warehouse.upsert({
    where: { code: 'SHOWROOM' },
    update: {},
    create: { code: 'SHOWROOM', name: 'Showroom', region: 'US', stockMode: 'SHELF_PRIMARY' },
  });
  console.log('✓ 3 depo upsert edildi (ANKARA, NJ, SHOWROOM)');
}

async function ensureNjPool() {
  return prisma.shelf.upsert({
    where: { warehouseCode_code: { warehouseCode: 'NJ', code: 'POOL' } },
    update: {},
    create: { warehouseCode: 'NJ', code: 'POOL', shelfType: 'POOL', notes: 'Havuz raf — sevkiyat varışı ve manuel girişler' },
  });
}

async function ensureShelves(rafCodes: string[]): Promise<Map<string, string>> {
  // rafCode → shelfId
  const map = new Map<string, string>();
  for (const code of rafCodes) {
    const shelf = await prisma.shelf.upsert({
      where: { warehouseCode_code: { warehouseCode: 'NJ', code } },
      update: {},
      create: { warehouseCode: 'NJ', code, shelfType: 'NORMAL' },
    });
    map.set(code, shelf.id);
  }
  return map;
}

async function lookupShipmentBoxIds(boxNumbers: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (boxNumbers.length === 0) return map;
  const found = await prisma.shipmentBox.findMany({
    where: { boxNumber: { in: boxNumbers } },
    select: { id: true, boxNumber: true },
  });
  for (const b of found) {
    if (!map.has(b.boxNumber)) map.set(b.boxNumber, b.id);
  }
  return map;
}

async function resolveSeedUserId(): Promise<string> {
  if (SEED_USER_ID) return SEED_USER_ID;
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  if (!admin) throw new Error('SEED_USER_ID env yok ve aktif ADMIN user bulunamadı.');
  return admin.id;
}

async function main() {
  console.log(`CSV: ${CSV_PATH}`);
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV bulunamadı: ${CSV_PATH}`);

  const rows = readCsv(CSV_PATH);
  console.log(`✓ ${rows.length} CSV satırı okundu`);

  const userId = await resolveSeedUserId();
  console.log(`✓ Seed user: ${userId}`);

  await ensureWarehouses();
  await ensureNjPool();

  // Unique raf codes
  const rafCodes = Array.from(new Set(rows.map((r) => r.raf)));
  const shelfMap = await ensureShelves(rafCodes);
  console.log(`✓ ${rafCodes.length} unique raf NJ'de upsert edildi`);

  // CSV "fnsku" kolonu → iwasku (4 alandan eşleşmeyi sırayla dene)
  const lookupValues = Array.from(new Set(rows.map((r) => r.fnsku)));
  const resolveMap = await resolveLookupValues(lookupValues);
  const byVia: Record<ResolveSource, number> = { fnsku: 0, asin: 0, iwasku: 0, sku: 0, products: 0 };
  for (const r of resolveMap.values()) byVia[r.via]++;
  console.log(
    `✓ ${resolveMap.size}/${lookupValues.length} eşleşme bulundu — ` +
      `fnsku=${byVia.fnsku}, asin=${byVia.asin}, iwasku=${byVia.iwasku}, sku=${byVia.sku}, products=${byVia.products}`
  );

  // ShipmentBox lookup for koli'li satırlar
  const koliNumbers = Array.from(new Set(rows.filter((r) => r.koli).map((r) => r.koli)));
  const boxIdMap = await lookupShipmentBoxIds(koliNumbers);
  console.log(`✓ ${boxIdMap.size}/${koliNumbers.length} koli numarası ShipmentBox'a bağlandı`);

  let stockInserted = 0;
  let stockUpdated = 0;
  let boxInserted = 0;
  let boxSkipped = 0;
  let unmatchedFnsku = 0;
  let unmatchedQueued = 0;
  let unmatchedAlreadyQueued = 0;

  for (const row of rows) {
    const resolved = resolveMap.get(row.fnsku);
    if (!resolved) {
      unmatchedFnsku++;
      // Admin mapping kuyruğuna yaz (idempotent: aynı kombinasyon varsa skip)
      const existing = await prisma.unmatchedSeedRow.findFirst({
        where: {
          warehouseCode: 'NJ',
          rawLookup: row.fnsku,
          shelfCode: row.raf,
          boxNumber: row.koli || null,
          status: 'PENDING',
        },
      });
      if (existing) {
        unmatchedAlreadyQueued++;
      } else {
        await prisma.unmatchedSeedRow.create({
          data: {
            warehouseCode: 'NJ',
            source: 'CSV_SEED',
            rawLookup: row.fnsku,
            description: row.description || null,
            shelfCode: row.raf,
            boxNumber: row.koli || null,
            quantity: row.amount,
          },
        });
        unmatchedQueued++;
      }
      continue;
    }
    const iwasku = resolved.iwasku;
    const shelfId = shelfMap.get(row.raf);
    if (!shelfId) {
      console.warn(`[SKIP] raf ${row.raf} için shelfId bulunamadı`);
      continue;
    }

    if (!row.koli) {
      // ShelfStock — aynı (shelfId, iwasku) varsa quantity üzerine yaz
      const existing = await prisma.shelfStock.findUnique({
        where: { shelfId_iwasku: { shelfId, iwasku } },
      });
      if (existing) {
        await prisma.shelfStock.update({
          where: { id: existing.id },
          data: { quantity: row.amount },
        });
        stockUpdated++;
      } else {
        await prisma.shelfStock.create({
          data: { warehouseCode: 'NJ', shelfId, iwasku, quantity: row.amount },
        });
        stockInserted++;
      }
      await prisma.shelfMovement.create({
        data: {
          warehouseCode: 'NJ',
          type: 'INBOUND_MANUAL',
          toShelfId: shelfId,
          iwasku,
          quantity: row.amount,
          refType: 'SEED',
          userId,
          notes: `CSV seed: ${row.description}`,
        },
      });
    } else {
      // ShelfBox — aynı boxNumber var ise skip (idempotent)
      const dupe = await prisma.shelfBox.findFirst({ where: { boxNumber: row.koli, warehouseCode: 'NJ' } });
      if (dupe) {
        boxSkipped++;
        continue;
      }
      const shipmentBoxId = boxIdMap.get(row.koli) ?? null;
      const created = await prisma.shelfBox.create({
        data: {
          warehouseCode: 'NJ',
          shelfId,
          shipmentBoxId,
          boxNumber: row.koli,
          iwasku,
          fnsku: row.fnsku,
          quantity: row.amount,
          status: 'SEALED',
        },
      });
      boxInserted++;
      await prisma.shelfMovement.create({
        data: {
          warehouseCode: 'NJ',
          type: 'INBOUND_MANUAL',
          toShelfId: shelfId,
          iwasku,
          quantity: row.amount,
          shelfBoxId: created.id,
          refType: 'SEED',
          userId,
          notes: `CSV seed: koli ${row.koli} (${row.description})`,
        },
      });
    }
  }

  console.log('\n=== Seed sonucu ===');
  console.log(`ShelfStock — yeni: ${stockInserted}, güncellenen: ${stockUpdated}`);
  console.log(`ShelfBox   — yeni: ${boxInserted}, atlanan (mevcut): ${boxSkipped}`);
  console.log(`Eşleşmeyen — yeni kuyruğa: ${unmatchedQueued}, kuyrukta zaten: ${unmatchedAlreadyQueued} (toplam satır: ${unmatchedFnsku})`);
  console.log('  → Admin mapping ekranı: /dashboard/depolar/NJ/raf (Eşleşmeyen Stok sekmesi)');
}

main()
  .catch((e) => {
    console.error('SEED HATA:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await productPool.end().catch(() => {});
  });
