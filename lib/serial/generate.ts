/**
 * Üretim etiketi seri numarası üreteci.
 *
 * IWASKU başına sıralı sayaç (`product_serial_counters`) kullanır. N adet seri
 * tek atomic UPSERT içinde alınır → race condition yok, paralel istekler birbirini ezmez.
 *
 * Format: "IWASKU-XXXXXX" (6 haneli, padded)
 * Örnek:  "SCS0120VQKBY-000001"
 */
import { prisma } from '@/lib/db/prisma';

export async function generateSerials(iwasku: string, quantity: number): Promise<string[]> {
  if (!iwasku) throw new Error('iwasku bos olamaz');
  if (quantity < 1) return [];
  if (quantity > 1000) throw new Error('Tek seferde en fazla 1000 seri uretilebilir');

  // Atomic increment: counter'a +N ekle, yeni `lastSerial` degerini al
  const rows = await prisma.$queryRaw<Array<{ lastSerial: number }>>`
    INSERT INTO product_serial_counters ("iwasku", "lastSerial", "createdAt", "updatedAt")
    VALUES (${iwasku}, ${quantity}, NOW(), NOW())
    ON CONFLICT ("iwasku") DO UPDATE SET
      "lastSerial" = product_serial_counters."lastSerial" + ${quantity},
      "updatedAt" = NOW()
    RETURNING "lastSerial"
  `;

  const lastSerial = Number(rows[0].lastSerial);
  const startSerial = lastSerial - quantity + 1;

  const serials: string[] = [];
  for (let i = 0; i < quantity; i++) {
    const num = String(startSerial + i).padStart(6, '0');
    serials.push(`${iwasku}-${num}`);
  }
  return serials;
}
