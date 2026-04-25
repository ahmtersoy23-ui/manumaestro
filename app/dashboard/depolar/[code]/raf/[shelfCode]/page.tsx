/**
 * Raf Detay Sayfası — rafın içindeki tekil ürünler + koliler + son hareketler.
 * Tekil ve koli satırlarında Transfer butonu (yetkili kullanıcılar için).
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ChevronLeft, Package, Box, History, AlertCircle, ArrowRightLeft, PackageOpen, Scissors } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { TransferDialog, type TransferSource } from '@/components/wms/TransferDialog';
import { BreakBoxDialog, type BreakBoxSource } from '@/components/wms/BreakBoxDialog';

const logger = createLogger('RafDetay');

interface ShelfStockRow {
  id: string;
  iwasku: string;
  productName: string | null;
  category: string | null;
  asin: string | null;
  quantity: number;
  reservedQty: number;
  availableQty: number;
}
interface ShelfBoxRow {
  id: string;
  boxNumber: string;
  iwasku: string;
  productName: string | null;
  category: string | null;
  asin: string | null;
  fnsku: string | null;
  marketplaceCode: string | null;
  destination: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  status: 'SEALED' | 'PARTIAL' | 'EMPTY';
  shipmentBoxId: string | null;
}
interface Movement {
  id: string;
  type: string;
  iwasku: string | null;
  quantity: number | null;
  fromShelfId: string | null;
  toShelfId: string | null;
  refType: string | null;
  notes: string | null;
  createdAt: string;
  reverseOfId: string | null;
  reversedBy: { id: string }[];
}
interface RafData {
  shelf: { id: string; code: string; shelfType: string; notes: string | null; warehouseCode: string };
  role: string;
  stocks: ShelfStockRow[];
  boxes: ShelfBoxRow[];
  movements: Movement[];
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  POOL: { label: 'Havuz', cls: 'bg-purple-100 text-purple-700' },
  TEMP: { label: 'Geçici', cls: 'bg-amber-100 text-amber-700' },
  NORMAL: { label: 'Normal', cls: 'bg-gray-100 text-gray-600' },
};

const STATUS_BADGE: Record<string, string> = {
  SEALED: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  EMPTY: 'bg-gray-100 text-gray-500',
};

export default function RafDetayPage({
  params,
}: {
  params: Promise<{ code: string; shelfCode: string }>;
}) {
  const { code: rawCode, shelfCode: rawShelfCode } = use(params);
  const code = rawCode.toUpperCase();
  const shelfCode = decodeURIComponent(rawShelfCode);

  const [data, setData] = useState<RafData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [transferSource, setTransferSource] = useState<TransferSource | null>(null);
  const [breakSource, setBreakSource] = useState<BreakBoxSource | null>(null);
  const [openingBoxId, setOpeningBoxId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}/raflar/${encodeURIComponent(shelfCode)}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d.data);
        else setError(d.error || 'Raf yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Raf detay fetch error', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, shelfCode, refreshKey]);

  const canTransfer = data && ['OPERATOR', 'MANAGER', 'ADMIN'].includes(data.role);
  const canBoxOps = data && ['OPERATOR', 'MANAGER', 'ADMIN'].includes(data.role);
  const handleSuccess = () => setRefreshKey((k) => k + 1);

  async function openBox(boxId: string, boxNumber: string) {
    if (!confirm(`Koli ${boxNumber} tamamen açılacak. Onaylıyor musun?`)) return;
    setOpeningBoxId(boxId);
    try {
      const res = await fetch(`/api/depolar/${code}/koli/${boxId}/open`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Koli açılamadı');
        return;
      }
      handleSuccess();
    } catch (e) {
      logger.error('Open box hatası', e);
      alert('Sunucu hatası');
    } finally {
      setOpeningBoxId(null);
    }
  }

  const [undoingId, setUndoingId] = useState<string | null>(null);
  async function undoMovement(movementId: string, type: string) {
    if (!confirm(`${type} hareketi geri alınacak. Onaylıyor musun?`)) return;
    setUndoingId(movementId);
    try {
      const res = await fetch(`/api/depolar/${code}/hareketler/${movementId}/undo`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Geri alınamadı');
        return;
      }
      handleSuccess();
    } catch (e) {
      logger.error('Undo hatası', e);
      alert('Sunucu hatası');
    } finally {
      setUndoingId(null);
    }
  }

  const UNDOABLE_TYPES = new Set([
    'TRANSFER', 'CROSS_WAREHOUSE_TRANSFER', 'INBOUND_MANUAL', 'INBOUND_FROM_SHIPMENT',
  ]);

  if (loading) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  if (!data) return null;

  const badge = TYPE_BADGE[data.shelf.shelfType] ?? TYPE_BADGE.NORMAL;
  const totalLoose = data.stocks.reduce((s, x) => s + x.quantity, 0);
  const totalBox = data.boxes
    .filter((b) => b.status !== 'EMPTY')
    .reduce((s, x) => s + x.quantity, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/dashboard/depolar/${code}/raf`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-2"
          >
            <ChevronLeft className="w-4 h-4" /> Raf Düzeni
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono text-gray-900">{data.shelf.code}</h1>
            <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          {data.shelf.notes && <p className="text-sm text-gray-500 mt-1">{data.shelf.notes}</p>}
        </div>
        <div className="text-right text-xs text-gray-500">
          <div>{totalLoose} tekil • {totalBox} koli adedi</div>
          <div className="mt-1">{data.stocks.length} satır • {data.boxes.filter(b => b.status !== 'EMPTY').length} aktif koli</div>
        </div>
      </div>

      {/* Tekil ürünler */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-medium text-gray-700">Tekil Ürünler</h2>
            <span className="text-xs text-gray-400">({data.stocks.length})</span>
          </div>
        </div>
        {data.stocks.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">Bu rafta tekil ürün yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-left px-4 py-2">FNSKU</th>
                  <th className="text-left px-4 py-2">ASIN</th>
                  <th className="text-left px-4 py-2">Ürün</th>
                  <th className="text-left px-4 py-2">Kategori</th>
                  <th className="text-right px-4 py-2">Adet</th>
                  <th className="text-right px-4 py-2">Rezerve</th>
                  <th className="text-right px-4 py-2">Kullanılabilir</th>
                  {canTransfer && <th className="text-right px-4 py-2 w-24">İşlem</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.stocks.map((s) => (
                  <tr key={s.id} className="text-gray-700">
                    <td className="px-4 py-2 font-mono text-xs">{s.iwasku}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-gray-400">—</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-gray-500">{s.asin ?? '—'}</td>
                    <td className="px-4 py-2 text-xs truncate max-w-[260px]">{s.productName ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{s.category ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-medium">{s.quantity}</td>
                    <td className="px-4 py-2 text-right text-amber-600">
                      {s.reservedQty > 0 ? s.reservedQty : ''}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">
                      {s.availableQty}
                    </td>
                    {canTransfer && (
                      <td className="px-4 py-2 text-right">
                        {s.availableQty > 0 ? (
                          <button
                            onClick={() =>
                              setTransferSource({
                                type: 'stock',
                                id: s.id,
                                iwasku: s.iwasku,
                                productName: s.productName,
                                available: s.availableQty,
                                fromShelfId: data.shelf.id,
                                fromShelfCode: data.shelf.code,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                            title="Transfer"
                          >
                            <ArrowRightLeft className="w-3 h-3" /> Transfer
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Koliler */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-medium text-gray-700">Koliler</h2>
            <span className="text-xs text-gray-400">({data.boxes.length})</span>
          </div>
        </div>
        {data.boxes.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">Bu rafta koli yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">Koli No</th>
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-left px-4 py-2">FNSKU</th>
                  <th className="text-left px-4 py-2">ASIN</th>
                  <th className="text-left px-4 py-2">Ürün</th>
                  <th className="text-left px-4 py-2">MP</th>
                  <th className="text-left px-4 py-2">Hedef</th>
                  <th className="text-right px-4 py-2">Adet</th>
                  <th className="text-left px-4 py-2">Durum</th>
                  {canTransfer && <th className="text-right px-4 py-2 w-24">İşlem</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.boxes.map((b) => (
                  <tr key={b.id} className="text-gray-700">
                    <td className="px-4 py-2 font-mono text-xs">{b.boxNumber}</td>
                    <td className="px-4 py-2 font-mono text-xs">{b.iwasku}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-gray-500">{b.fnsku ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-gray-500">{b.asin ?? '—'}</td>
                    <td className="px-4 py-2 text-xs truncate max-w-[220px]">{b.productName ?? '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-gray-500">{b.marketplaceCode ?? '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-gray-500">{b.destination}</td>
                    <td className="px-4 py-2 text-right font-medium">{b.quantity}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${STATUS_BADGE[b.status]}`}>
                        {b.status}
                      </span>
                    </td>
                    {canTransfer && (
                      <td className="px-4 py-2 text-right">
                        {b.status !== 'EMPTY' && b.reservedQty === 0 ? (
                          <div className="inline-flex flex-wrap gap-1 justify-end">
                            <button
                              onClick={() =>
                                setTransferSource({
                                  type: 'box',
                                  id: b.id,
                                  iwasku: b.iwasku,
                                  productName: b.productName,
                                  available: b.quantity,
                                  boxNumber: b.boxNumber,
                                  fromShelfId: data.shelf.id,
                                  fromShelfCode: data.shelf.code,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                              title="Transfer"
                            >
                              <ArrowRightLeft className="w-3 h-3" /> Transfer
                            </button>
                            {canBoxOps && (
                              <>
                                <button
                                  onClick={() =>
                                    setBreakSource({
                                      id: b.id,
                                      boxNumber: b.boxNumber,
                                      iwasku: b.iwasku,
                                      productName: b.productName,
                                      available: b.availableQty,
                                      reservedQty: b.reservedQty,
                                      shelfCode: data.shelf.code,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-amber-700 bg-amber-50 hover:bg-amber-100 rounded"
                                  title="Kısmi al / parçala"
                                >
                                  <Scissors className="w-3 h-3" /> Parçala
                                </button>
                                <button
                                  onClick={() => openBox(b.id, b.boxNumber)}
                                  disabled={openingBoxId === b.id}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-green-700 bg-green-50 hover:bg-green-100 rounded disabled:opacity-50"
                                  title="Tüm koliyi aç (içeriği rafa boşalt)"
                                >
                                  <PackageOpen className="w-3 h-3" /> {openingBoxId === b.id ? '...' : 'Aç'}
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Son hareketler */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-medium text-gray-700">Bu Rafa Ait Son Hareketler</h2>
        </div>
        {data.movements.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">Henüz hareket yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">Zaman</th>
                  <th className="text-left px-4 py-2">Tip</th>
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-right px-4 py-2">Adet</th>
                  <th className="text-left px-4 py-2">Yön</th>
                  <th className="text-left px-4 py-2">Not</th>
                  {canTransfer && <th className="text-right px-4 py-2 w-28">Durum</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.movements.map((m) => {
                  const dir =
                    m.toShelfId === data.shelf.id && m.fromShelfId !== data.shelf.id
                      ? 'Geldi'
                      : m.fromShelfId === data.shelf.id && m.toShelfId !== data.shelf.id
                      ? 'Gitti'
                      : '—';
                  const isReversed = (m.reversedBy?.length ?? 0) > 0;
                  const isReversal = m.type === 'REVERSAL';
                  const canUndo = !isReversed && !isReversal && UNDOABLE_TYPES.has(m.type);
                  return (
                    <tr key={m.id} className={`text-gray-700 ${isReversed ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {new Date(m.createdAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px]">{m.type}</td>
                      <td className="px-4 py-2 font-mono text-xs">{m.iwasku ?? '—'}</td>
                      <td className="px-4 py-2 text-right">{m.quantity ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{dir}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 truncate max-w-[200px]">
                        {m.notes ?? ''}
                      </td>
                      {canTransfer && (
                        <td className="px-4 py-2 text-right">
                          {isReversed ? (
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                              Geri alındı
                            </span>
                          ) : isReversal ? (
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                              Reversal
                            </span>
                          ) : canUndo ? (
                            <button
                              onClick={() => undoMovement(m.id, m.type)}
                              disabled={undoingId === m.id}
                              className="text-[11px] text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded disabled:opacity-50"
                              title="Bu hareketi geri al"
                            >
                              {undoingId === m.id ? '…' : 'Geri Al'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-gray-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transfer modal */}
      <TransferDialog
        isOpen={!!transferSource}
        warehouseCode={code}
        source={transferSource}
        onClose={() => setTransferSource(null)}
        onSuccess={handleSuccess}
      />

      {/* Parçala modal */}
      <BreakBoxDialog
        isOpen={!!breakSource}
        warehouseCode={code}
        source={breakSource}
        onClose={() => setBreakSource(null)}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
