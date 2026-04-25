/**
 * Sipariş Çıkış Sekmesi — STUB (sadece NJ + SHOWROOM'da görünür).
 * Bir sonraki commit'te:
 *   - SINGLE tipi sipariş (marketplace + order_no + raf/koli seçim, kısmi koli kırma)
 *   - FBA_PICKUP tipi (SEALED + AMZN_* filtreli koli grid, tek-tık tam koli)
 *   - 2-adımlı DRAFT → SHIPPED + rezerve mantığı
 *   - Role gate: PACKER yaratabilir, MANAGER onaylar
 */

'use client';

import { use } from 'react';
import { redirect } from 'next/navigation';
import { PackageOpen, AlertTriangle } from 'lucide-react';

export default function SiparisPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  // Ankara'da sipariş çıkış yok
  if (code === 'ANKARA') {
    redirect('/dashboard/depolar/ANKARA');
  }

  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-500">
      <PackageOpen className="w-10 h-10 mx-auto text-gray-400 mb-3" />
      <h2 className="text-lg font-semibold text-gray-700">Sipariş Çıkış — {code}</h2>
      <p className="text-sm mt-2 max-w-md mx-auto">
        Bu sekme sonraki adımda dolacak: SINGLE (marketplace siparişi) + FBA_PICKUP (koli bazlı pickup),
        2-adımlı DRAFT → SHIPPED akışı, rezerve mantığı.
      </p>
      <div className="mt-4 inline-flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded">
        <AlertTriangle className="w-3 h-3" /> Geliştirme aşamasında
      </div>
    </div>
  );
}
