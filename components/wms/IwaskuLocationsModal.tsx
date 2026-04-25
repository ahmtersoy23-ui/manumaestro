/**
 * Bir iwasku'nun depodaki tüm raf+koli konumlarını gösteren read-only modal.
 * Dashboard ve sipariş kalem ekleme akışı dışındaki yerlerde "ürün nerede?" sorusu için.
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Package, Box as BoxIcon, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('IwaskuLocationsModal');

interface StockLoc {
  id: string;
  shelfCode: string;
  shelfType: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
}
interface BoxLoc {
  id: string;
  shelfCode: string;
  boxNumber: string;
  fnsku: string | null;
  marketplaceCode: string | null;
  destination: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  status: string;
}
interface Locations {
  iwasku: string;
  stocks: StockLoc[];
  boxes: BoxLoc[];
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  iwasku: string | null;
  productName?: string | null;
  onClose: () => void;
}

export function IwaskuLocationsModal({ isOpen, warehouseCode, iwasku, productName, onClose }: Props) {
  const [data, setData] = useState<Locations | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !iwasku) return;
    let cancelled = false;
    fetch(
      `/api/depolar/${warehouseCode}/iwasku-konumlar?iwasku=${encodeURIComponent(iwasku)}`,
      { credentials: 'include' }
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d.data);
        else setError(d.error || 'Konum bilgisi alınamadı');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Locations fetch', e);
        setError('Sunucuya bağlanılamadı');
      });
    return () => { cancelled = true; };
  }, [isOpen, warehouseCode, iwasku]);

  if (!isOpen || !iwasku) return null;

  // Data eski bir iwasku'ya aitse loading göster (yeni fetch henüz dönmedi)
  const dataMatches = data?.iwasku === iwasku;
  const visibleData = dataMatches ? data : null;

  const totalLoose = visibleData?.stocks.reduce((s, x) => s + x.quantity, 0) ?? 0;
  const totalBox = visibleData?.boxes.reduce((s, x) => s + x.quantity, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="font-mono text-sm">{iwasku}</span>
              <span className="text-xs text-gray-500 font-normal">@ {warehouseCode}</span>
            </h2>
            {productName && <p className="text-xs text-gray-600 mt-0.5">{productName}</p>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              {error}
            </div>
          )}

          {!visibleData && !error && (
            <div className="text-center text-gray-500 text-sm py-6">Yükleniyor…</div>
          )}

          {visibleData && (
            <>
              {visibleData.stocks.length === 0 && visibleData.boxes.length === 0 && (
                <div className="text-center text-gray-500 text-sm py-6">
                  Bu ürünün depoda kullanılabilir konumu yok.
                </div>
              )}

              {/* Tekil ürün */}
              {visibleData.stocks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-500" />
                      Tekil Ürün ({visibleData.stocks.length} raf)
                    </h3>
                    <span className="text-xs text-gray-500">Toplam {totalLoose}</span>
                  </div>
                  <table className="w-full text-sm border border-gray-200 rounded">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="text-left px-3 py-1.5">Raf</th>
                        <th className="text-right px-3 py-1.5">Adet</th>
                        <th className="text-right px-3 py-1.5">Rezerve</th>
                        <th className="text-right px-3 py-1.5">Kullanılabilir</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleData.stocks.map((s) => (
                        <tr key={s.id} className="text-gray-700">
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {s.shelfCode}
                            <span className="ml-2 text-[10px] uppercase text-gray-400">{s.shelfType}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right">{s.quantity}</td>
                          <td className="px-3 py-1.5 text-right text-amber-600">
                            {s.reservedQty > 0 ? s.reservedQty : ''}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold">{s.availableQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Koli */}
              {visibleData.boxes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <BoxIcon className="w-4 h-4 text-gray-500" />
                      Koli ({visibleData.boxes.length})
                    </h3>
                    <span className="text-xs text-gray-500">Toplam {totalBox}</span>
                  </div>
                  <table className="w-full text-sm border border-gray-200 rounded">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="text-left px-3 py-1.5">Koli No</th>
                        <th className="text-left px-3 py-1.5">Raf</th>
                        <th className="text-left px-3 py-1.5">MP</th>
                        <th className="text-left px-3 py-1.5">Hedef</th>
                        <th className="text-right px-3 py-1.5">Adet</th>
                        <th className="text-left px-3 py-1.5">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleData.boxes.map((b) => (
                        <tr key={b.id} className="text-gray-700">
                          <td className="px-3 py-1.5 font-mono text-xs">{b.boxNumber}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{b.shelfCode}</td>
                          <td className="px-3 py-1.5 text-[11px] text-gray-500">{b.marketplaceCode ?? '—'}</td>
                          <td className="px-3 py-1.5 text-[11px] text-gray-500">{b.destination}</td>
                          <td className="px-3 py-1.5 text-right">{b.quantity}</td>
                          <td className="px-3 py-1.5">
                            <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                              b.status === 'SEALED' ? 'bg-green-100 text-green-700' :
                              b.status === 'PARTIAL' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {b.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
