/**
 * Somerset (NJ) → Fairfield (SHOWROOM) tek-ürün transfer modalı.
 * Transfer tavsiye listesindeki bir satır için NJ kaynaklarını (tekil + koli)
 * listeler; operatör kaynağı + miktarı seçip mevcut /transfer endpoint'iyle
 * SHOWROOM POOL rafına (FF-HAVUZ) gönderir.
 *
 * Tekil (stock): kısmi miktar serbest. Koli (box): komple taşınır; rezerveli
 * koli taşınamaz (endpoint reddeder).
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Package, Box as BoxIcon, AlertCircle, ArrowRight } from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TransferToFairfieldModal');

interface StockLoc {
  id: string;
  shelfCode: string;
  shelfType: string;
  availableQty: number;
}
interface BoxLoc {
  id: string;
  shelfCode: string;
  boxNumber: string;
  availableQty: number;
  reservedQty: number;
  status: string;
}

interface Props {
  warehouseCode: string; // kaynak depo (NJ)
  iwasku: string;
  productName: string | null;
  destinationShelfId: string;
  destinationLabel: string; // örn. "FF-HAVUZ"
  onClose: () => void;
  onDone: () => void; // başarılı transfer sonrası listeyi tazele
}

export function TransferToFairfieldModal({
  warehouseCode,
  iwasku,
  productName,
  destinationShelfId,
  destinationLabel,
  onClose,
  onDone,
}: Props) {
  const [stocks, setStocks] = useState<StockLoc[] | null>(null);
  const [boxes, setBoxes] = useState<BoxLoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    fetch(`/api/depolar/${warehouseCode}/iwasku-konumlar?iwasku=${encodeURIComponent(iwasku)}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setStocks(d.data.stocks);
          setBoxes(d.data.boxes);
          setQty(
            Object.fromEntries(d.data.stocks.map((s: StockLoc) => [s.id, s.availableQty]))
          );
        } else setError(d.error || 'Konumlar alınamadı');
      })
      .catch((e) => {
        logger.error('konum fetch', e);
        setError('Sunucuya bağlanılamadı');
      });
  };

  useEffect(load, [warehouseCode, iwasku]);

  async function transfer(source: { type: 'stock' | 'box'; id: string }, quantity?: number) {
    setBusyId(source.id);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/transfer`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          toShelfId: destinationShelfId,
          ...(quantity ? { quantity } : {}),
          notes: `Fairfield'a transfer önerisi: ${iwasku}`,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        notify.error(d.error || 'Transfer başarısız');
        return;
      }
      notify.success(`Fairfield'a (${destinationLabel}) transfer edildi`);
      onDone();
      load(); // kalan kaynakları tazele
    } catch (e) {
      logger.error('transfer hatası', e);
      notify.error('Sunucu hatası');
    } finally {
      setBusyId(null);
    }
  }

  const loading = stocks === null && boxes === null && !error;
  const empty = !loading && (stocks?.length ?? 0) === 0 && (boxes?.length ?? 0) === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto text-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="font-mono text-sm">{iwasku}</span>
              <span className="text-xs text-gray-500 font-normal flex items-center gap-1">
                Somerset <ArrowRight className="w-3 h-3" /> Fairfield ({destinationLabel})
              </span>
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
          {loading && <div className="text-center text-gray-500 text-sm py-6">Yükleniyor…</div>}
          {empty && (
            <div className="text-center text-gray-500 text-sm py-6">
              Somerset&apos;te transfer edilebilir kaynak kalmadı.
            </div>
          )}

          {/* Tekil ürün — kısmi miktar */}
          {(stocks?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-gray-500" /> Tekil Ürün
              </h3>
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">Raf</th>
                    <th className="text-right px-3 py-1.5">Mevcut</th>
                    <th className="text-right px-3 py-1.5">Miktar</th>
                    <th className="px-3 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stocks!.map((s) => (
                    <tr key={s.id} className="text-gray-700">
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {s.shelfCode}
                        <span className="ml-2 text-[10px] uppercase text-gray-400">{s.shelfType}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">{s.availableQty}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          min={1}
                          max={s.availableQty}
                          value={qty[s.id] ?? ''}
                          onChange={(e) =>
                            setQty((q) => ({ ...q, [s.id]: Math.max(0, Number(e.target.value)) }))
                          }
                          className="w-20 px-2 py-1 border border-gray-200 rounded text-right text-sm focus:outline-none focus:border-blue-400"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => transfer({ type: 'stock', id: s.id }, qty[s.id])}
                          disabled={
                            busyId === s.id || !qty[s.id] || qty[s.id] < 1 || qty[s.id] > s.availableQty
                          }
                          className="text-[11px] text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 rounded disabled:opacity-40"
                        >
                          {busyId === s.id ? '…' : 'Transfer'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Koli — komple */}
          {(boxes?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                <BoxIcon className="w-4 h-4 text-gray-500" /> Koli (komple taşınır)
              </h3>
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">Koli No</th>
                    <th className="text-left px-3 py-1.5">Raf</th>
                    <th className="text-right px-3 py-1.5">Adet</th>
                    <th className="px-3 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {boxes!.map((b) => (
                    <tr key={b.id} className="text-gray-700">
                      <td className="px-3 py-1.5 font-mono text-xs">{b.boxNumber}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{b.shelfCode}</td>
                      <td className="px-3 py-1.5 text-right">{b.availableQty}</td>
                      <td className="px-3 py-1.5 text-right">
                        {b.reservedQty > 0 ? (
                          <span className="text-[10px] text-amber-600">rezerveli</span>
                        ) : (
                          <button
                            onClick={() => transfer({ type: 'box', id: b.id })}
                            disabled={busyId === b.id}
                            className="text-[11px] text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 rounded disabled:opacity-40"
                          >
                            {busyId === b.id ? '…' : 'Transfer'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
