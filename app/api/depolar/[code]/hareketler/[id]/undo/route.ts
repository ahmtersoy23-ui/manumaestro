/**
 * POST /api/depolar/[code]/hareketler/[id]/undo
 * Bir ShelfMovement'ı geri al — audit-preserving (orijinal silinmez,
 * ters bir REVERSAL hareketi yaratılır, original.reversedById set edilir).
 *
 * v1'de desteklenen tipler:
 *   - TRANSFER, CROSS_WAREHOUSE_TRANSFER
 *   - INBOUND_MANUAL (sadece koli SEALED ve quantity orijinaliyle aynıysa)
 *   - INBOUND_FROM_SHIPMENT (sadece koli SEALED ve aynı raftaysa)
 *
 * v1'de DEVRE DIŞI:
 *   - BOX_OPEN, BOX_BREAK (içerik dağıldı, manuel düzeltme)
 *   - OUTBOUND (Faz 4'te ele alınacak)
 *   - REVERSAL (zaten tersine alındı)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { Prisma } from '@prisma/client';

const OWN_RECENT_HOURS = 24;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id: movementId } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  // Auth: ya undoAny ya undoOwnRecent — esas yetki kontrolü içeride
  const auth = await requireShelfAction(request, upperCode, 'undoOwnRecent');
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const orig = await tx.shelfMovement.findUnique({
        where: { id: movementId },
        include: { reversedBy: { select: { id: true } } },
      });
      if (!orig) throw new Error('Hareket bulunamadı');
      if (orig.warehouseCode !== upperCode) throw new Error('Hareket bu depoya ait değil');
      if (orig.reversedBy.length > 0) throw new Error('Bu hareket zaten geri alınmış');
      if (orig.type === 'REVERSAL') throw new Error('REVERSAL hareketi geri alınamaz');

      // Yetki: MANAGER+ herhangi birini, OPERATOR sadece kendi son 24 saat
      const isManagerPlus = ['MANAGER', 'ADMIN'].includes(auth.shelfRole);
      if (!isManagerPlus) {
        if (orig.userId !== auth.user.id) {
          throw new Error('Sadece kendi hareketini geri alabilirsin (Manager onayı gerekir)');
        }
        const ageMs = Date.now() - orig.createdAt.getTime();
        if (ageMs > OWN_RECENT_HOURS * 3600 * 1000) {
          throw new Error(`OPERATOR ${OWN_RECENT_HOURS} saatten eski hareketi geri alamaz`);
        }
      }

      // Tip-spesifik reverse mantığı
      const reverse = await reverseMovement(tx, orig);

      // REVERSAL hareketi yarat
      const reversal = await tx.shelfMovement.create({
        data: {
          warehouseCode: upperCode,
          type: 'REVERSAL',
          fromShelfId: reverse.fromShelfId,
          toShelfId: reverse.toShelfId,
          iwasku: orig.iwasku,
          quantity: orig.quantity,
          shelfBoxId: orig.shelfBoxId,
          refType: 'UNDO',
          refId: orig.id,
          reverseOfId: orig.id,
          userId: auth.user.id,
          notes: `Geri alındı: ${orig.type} (${orig.notes ?? '—'})`,
        },
      });

      // Orijinali işaretlemeye gerek yok — REVERSAL'ın reverseOfId'si bağlantıyı kuruyor.
      // UI tarafı orig.reversedBy[] üzerinden tespit eder.

      return { reversalId: reversal.id, originalId: orig.id, originalType: orig.type };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Geri alma başarısız';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

type Tx = Prisma.TransactionClient;

interface Movement {
  id: string;
  warehouseCode: string;
  type: string;
  fromShelfId: string | null;
  toShelfId: string | null;
  iwasku: string | null;
  quantity: number | null;
  shelfBoxId: string | null;
}

/**
 * Tip-spesifik reverse: stok/koli değişikliklerini geri uygular.
 * Returns: { fromShelfId, toShelfId } — REVERSAL hareketinin yön bilgisi.
 */
async function reverseMovement(
  tx: Tx,
  m: Movement
): Promise<{ fromShelfId: string | null; toShelfId: string | null }> {
  switch (m.type) {
    case 'TRANSFER':
    case 'CROSS_WAREHOUSE_TRANSFER':
      return reverseTransfer(tx, m);

    case 'INBOUND_MANUAL':
      return reverseInboundManual(tx, m);

    case 'INBOUND_FROM_SHIPMENT':
      return reverseInboundFromShipment(tx, m);

    case 'BOX_OPEN':
    case 'BOX_BREAK':
      throw new Error(
        `${m.type} geri alma desteklenmiyor (içerik dağıldı; raf detayında manuel düzelt)`
      );

    case 'OUTBOUND':
      throw new Error('OUTBOUND geri alma sipariş çıkış sayfasından yapılır');

    default:
      throw new Error(`${m.type} geri alma desteklenmiyor`);
  }
}

async function reverseTransfer(tx: Tx, m: Movement) {
  if (!m.fromShelfId || !m.toShelfId || !m.iwasku || !m.quantity) {
    throw new Error('Eksik transfer bilgisi — geri alınamaz');
  }

  if (m.shelfBoxId) {
    // Koli transfer'i: koli hâlâ to shelf'te mi?
    const box = await tx.shelfBox.findUnique({ where: { id: m.shelfBoxId } });
    if (!box) throw new Error('Koli artık yok — geri alınamaz');
    if (box.shelfId !== m.toShelfId) {
      throw new Error('Koli başka rafa taşınmış — geri alınamaz, manuel düzelt');
    }
    if (box.reservedQty > 0) {
      throw new Error('Koli rezerve edilmiş — önce rezerveyi serbest bırak');
    }
    // Geri taşı (cross-warehouse'da from rafının deposu farklı)
    const fromShelf = await tx.shelf.findUnique({ where: { id: m.fromShelfId } });
    if (!fromShelf) throw new Error('Kaynak raf artık yok');
    await tx.shelfBox.update({
      where: { id: box.id },
      data: { shelfId: m.fromShelfId, warehouseCode: fromShelf.warehouseCode },
    });
  } else {
    // ShelfStock transfer: hedefte miktar var mı?
    const target = await tx.shelfStock.findUnique({
      where: { shelfId_iwasku: { shelfId: m.toShelfId, iwasku: m.iwasku } },
    });
    if (!target) throw new Error('Hedef raftaki stok artık yok — geri alınamaz');
    const available = target.quantity - target.reservedQty;
    if (available < m.quantity) {
      throw new Error(`Hedef rafta yetersiz stok kaldı (${available} < ${m.quantity})`);
    }
    // Hedeften düş
    if (target.quantity === m.quantity) {
      await tx.shelfStock.delete({ where: { id: target.id } });
    } else {
      await tx.shelfStock.update({
        where: { id: target.id },
        data: { quantity: { decrement: m.quantity } },
      });
    }
    // Kaynağa ekle (upsert)
    const fromShelf = await tx.shelf.findUnique({ where: { id: m.fromShelfId } });
    if (!fromShelf) throw new Error('Kaynak raf artık yok');
    const existing = await tx.shelfStock.findUnique({
      where: { shelfId_iwasku: { shelfId: m.fromShelfId, iwasku: m.iwasku } },
    });
    if (existing) {
      await tx.shelfStock.update({
        where: { id: existing.id },
        data: { quantity: { increment: m.quantity } },
      });
    } else {
      await tx.shelfStock.create({
        data: {
          warehouseCode: fromShelf.warehouseCode,
          shelfId: m.fromShelfId,
          iwasku: m.iwasku,
          quantity: m.quantity,
        },
      });
    }
  }

  return { fromShelfId: m.toShelfId, toShelfId: m.fromShelfId };
}

async function reverseInboundManual(tx: Tx, m: Movement) {
  if (!m.shelfBoxId || !m.iwasku || !m.quantity) {
    throw new Error('Eksik manuel koli bilgisi — geri alınamaz');
  }
  const box = await tx.shelfBox.findUnique({ where: { id: m.shelfBoxId } });
  if (!box) throw new Error('Koli zaten silinmiş — geri alınamaz');
  if (box.status !== 'SEALED') {
    throw new Error('Koli açılmış/parçalanmış — geri alınamaz, manuel düzelt');
  }
  if (box.reservedQty > 0) {
    throw new Error('Koli rezerve edilmiş — önce rezerveyi serbest bırak');
  }
  if (box.quantity !== m.quantity) {
    throw new Error('Koli miktarı değişmiş — geri alınamaz');
  }

  const shipmentBoxId = box.shipmentBoxId;
  await tx.shelfBox.delete({ where: { id: box.id } });
  if (shipmentBoxId) {
    // Manuel girişin orijinal ShipmentBox kaydını da sil
    await tx.shipmentBox.delete({ where: { id: shipmentBoxId } }).catch(() => {});
  }

  return { fromShelfId: m.toShelfId, toShelfId: null };
}

async function reverseInboundFromShipment(tx: Tx, m: Movement) {
  if (!m.shelfBoxId || !m.toShelfId) {
    throw new Error('Eksik sevkiyat-varış bilgisi — geri alınamaz');
  }
  const box = await tx.shelfBox.findUnique({ where: { id: m.shelfBoxId } });
  if (!box) throw new Error('Koli zaten silinmiş — geri alınamaz');
  if (box.status !== 'SEALED') {
    throw new Error('Koli açılmış/parçalanmış — geri alınamaz');
  }
  if (box.shelfId !== m.toShelfId) {
    throw new Error('Koli başka rafa taşınmış — geri alınamaz');
  }
  if (box.reservedQty > 0) {
    throw new Error('Koli rezerve edilmiş — önce rezerveyi serbest bırak');
  }

  // ShipmentBox kaydı korunur (sevkiyatın parçası), sadece ShelfBox silinir
  await tx.shelfBox.delete({ where: { id: box.id } });

  return { fromShelfId: m.toShelfId, toShelfId: null };
}
