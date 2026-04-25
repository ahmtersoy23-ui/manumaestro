/**
 * Yeni Sipariş Yarat — STUB.
 * 4b: SINGLE (raf+koli karışık seçim, kısmi koli kırma destekli)
 * 4c: FBA_PICKUP (NJ'de SEALED + AMZN_* filtreli koli grid, tek-tık tam koli)
 */

'use client';

import { use } from 'react';
import Link from 'next/link';
import { ChevronLeft, AlertTriangle } from 'lucide-react';

export default function YeniSiparisPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/depolar/${code}/siparis`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sipariş Çıkış
      </Link>
      <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-500">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-400 mb-3" />
        <h2 className="text-lg font-semibold text-gray-700">Yeni Sipariş — Yakında</h2>
        <p className="text-sm mt-2 max-w-md mx-auto">
          Sipariş yaratma arayüzü sıradaki adımda gelecek (SINGLE: raf+koli seçimi, FBA_PICKUP: koli grid).
          API hazır, UI inşa aşamasında.
        </p>
      </div>
    </div>
  );
}
