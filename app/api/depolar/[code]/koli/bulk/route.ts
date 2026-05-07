/**
 * POST /api/depolar/[code]/koli/bulk
 * Excel/CSV ile toplu koli ekleme. Her satır kendi transaction'ında işlenir
 * (partial success): hatalı satır tüm batch'i bozmaz, sonuç batch raporu
 * döner ({ created, errors[] }).
 *
 * Body: { rows: [{ iwasku, quantity, marketplaceCode, destination?, boxNumber?, targetShelfCode? }] }
 *   - destination: 'FBA' | 'DEPO' | 'SHOWROOM' (default: 'DEPO')
 *   - boxNumber boşsa otomatik MAN-{code}-N
 *   - targetShelfCode boşsa POOL'a düşer (yoksa hata)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const RowSchema = z.object({
  iwasku: z.string().trim().min(1),
  quantity: z.number().int().positive().max(100000),
  marketplaceCode: z.string().trim().min(1).max(50),
  destination: z.enum(['FBA', 'DEPO', 'SHOWROOM']).optional(),
  boxNumber: z.string().trim().max(50).optional(),
  targetShelfCode: z.string().trim().max(50).optional(),
});

const BulkSchema = z.object({
  rows: z.array(RowSchema).min(1).max(500),
});

const DESTINATION_TAB: Record<string, string> = {
  ANKARA: 'TR',
  NJ: 'US',
  SHOWROOM: 'US_SHOWROOM',
};

interface RowError {
  index: number;
  iwasku: string;
  message: string;
}

interface RowOk {
  index: number;
  iwasku: string;
  boxNumber: string;
  shelfCode: string;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'addManualBox');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }

  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { rows } = parsed.data;
  const destinationTab = DESTINATION_TAB[upperCode] ?? 'TR';

  // Tüm raflar tek seferde — code → id map (her satır için lookup ucuz)
  const allShelves = await prisma.shelf.findMany({
    where: { warehouseCode: upperCode, isActive: true },
    select: { id: true, code: true, shelfType: true },
  });
  const shelfByCode = new Map(allShelves.map((s) => [s.code.toUpperCase(), s]));
  const poolShelf = allShelves.find((s) => s.shelfType === 'POOL');

  // Synthetic shipment'ı bir kerelik upsert et
  const syntheticName = `Manuel Giriş — ${upperCode}`;
  let shipment = await prisma.shipment.findFirst({
    where: { name: syntheticName, destinationTab },
  });
  if (!shipment) {
    shipment = await prisma.shipment.create({
      data: {
        name: syntheticName,
        destinationTab,
        shippingMethod: 'manual',
        status: 'DELIVERED',
        notes: 'Sevkiyat-dışı manuel koli girişlerinin kapsayıcı kaydı.',
      },
    });
  }

  // Her satır için kendi transaction
  const created: RowOk[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      // Hedef raf
      const targetShelf = row.targetShelfCode
        ? shelfByCode.get(row.targetShelfCode.toUpperCase())
        : poolShelf;
      if (!targetShelf) {
        throw new Error(
          row.targetShelfCode
            ? `Hedef raf bulunamadı: ${row.targetShelfCode}`
            : `${upperCode} deposunda POOL raf yok`
        );
      }

      // FNSKU lookup
      let fnsku: string | null = null;
      try {
        const r = (await queryProductDb(
          `SELECT fnsku FROM sku_master WHERE iwasku = $1 AND fnsku IS NOT NULL LIMIT 1`,
          [row.iwasku]
        )) as Array<{ fnsku: string }>;
        fnsku = r[0]?.fnsku ?? null;
      } catch {
        // OK — kritik değil
      }

      const result = await prisma.$transaction(async (tx) => {
        // boxNumber (verilmedi → otomatik MAN-{code}-NNN)
        let finalBoxNumber: string;
        if (row.boxNumber) {
          const dup = await tx.shipmentBox.findFirst({
            where: { boxNumber: row.boxNumber },
            select: { id: true },
          });
          if (dup) throw new Error(`Koli no "${row.boxNumber}" zaten kullanımda`);
          finalBoxNumber = row.boxNumber;
        } else {
          const prefix = `MAN-${upperCode}-`;
          const last = await tx.shipmentBox.findFirst({
            where: { boxNumber: { startsWith: prefix } },
            orderBy: { boxNumber: 'desc' },
            select: { boxNumber: true },
          });
          const nextSeq = last ? Number(last.boxNumber.replace(prefix, '')) + 1 : 1;
          finalBoxNumber = `${prefix}${String(nextSeq).padStart(3, '0')}`;
        }

        const destination = row.destination ?? 'DEPO';

        const shipmentBox = await tx.shipmentBox.create({
          data: {
            shipmentId: shipment!.id,
            boxNumber: finalBoxNumber,
            iwasku: row.iwasku,
            fnsku,
            marketplaceCode: row.marketplaceCode,
            destination,
            quantity: row.quantity,
          },
        });

        const shelfBox = await tx.shelfBox.create({
          data: {
            warehouseCode: upperCode,
            shelfId: targetShelf!.id,
            shipmentBoxId: shipmentBox.id,
            boxNumber: finalBoxNumber,
            iwasku: row.iwasku,
            fnsku,
            marketplaceCode: row.marketplaceCode,
            destination,
            quantity: row.quantity,
            status: 'SEALED',
          },
        });

        await tx.shelfMovement.create({
          data: {
            warehouseCode: upperCode,
            type: 'INBOUND_MANUAL',
            toShelfId: targetShelf!.id,
            iwasku: row.iwasku,
            quantity: row.quantity,
            shelfBoxId: shelfBox.id,
            refType: 'MANUAL_BOX_BULK',
            refId: shipmentBox.id,
            userId: auth.user.id,
            notes: `Toplu Excel koli: ${finalBoxNumber}`,
          },
        });

        return { boxNumber: finalBoxNumber, shelfCode: targetShelf!.code };
      });

      created.push({
        index: i,
        iwasku: row.iwasku,
        boxNumber: result.boxNumber,
        shelfCode: result.shelfCode,
      });
    } catch (e) {
      errors.push({
        index: i,
        iwasku: row.iwasku,
        message: e instanceof Error ? e.message : 'Bilinmeyen hata',
      });
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      total: rows.length,
      created: created.length,
      errorCount: errors.length,
      createdRows: created,
      errors,
    },
  });
}
