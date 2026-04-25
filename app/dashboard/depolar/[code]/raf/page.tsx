/**
 * Raf Düzeni Sekmesi — STUB.
 * Bir sonraki commit'te:
 *   - Raf grid + arama (SKU/FNSKU/raf kodu/koli no)
 *   - Yeni raf ekleme (tekil + bulk)
 *   - Raflar arası transfer (drag-drop + modal)
 *   - Koli aç / parçala
 *   - Manuel koli ekleme
 *   - Eşleşmeyen Stok alt-sekmesi
 */

'use client';

import { use } from 'react';
import { LayoutGrid, AlertTriangle } from 'lucide-react';

export default function RafPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-500">
      <LayoutGrid className="w-10 h-10 mx-auto text-gray-400 mb-3" />
      <h2 className="text-lg font-semibold text-gray-700">Raf Düzeni — {code.toUpperCase()}</h2>
      <p className="text-sm mt-2 max-w-md mx-auto">
        Bu sekme sonraki adımda dolacak: raf grid + arama, yeni raf, transfer, koli aç/parçala,
        manuel koli, eşleşmeyen stok mapping.
      </p>
      <div className="mt-4 inline-flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded">
        <AlertTriangle className="w-3 h-3" /> Geliştirme aşamasında
      </div>
    </div>
  );
}
