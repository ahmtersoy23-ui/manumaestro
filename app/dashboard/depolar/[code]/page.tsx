/**
 * Depo Dashboard Sekmesi (default tab).
 * Üstte prominent arama kutusu (henüz stub).
 * Ankara (TOTALS_PRIMARY): toplam mevcut + ürün sayısı + detaylı sayfa link.
 * NJ/Showroom (SHELF_PRIMARY): tekil/koli/raf kırılımı + koli durum dağılımı.
 */

'use client';

import { useEffect, useState, useMemo, use } from 'react';
import { Search, Layers, Package, Box, AlertTriangle, History, ExternalLink } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import WarehouseStockView from '@/components/warehouse/WarehouseStockView';
import { IwaskuLocationsModal } from '@/components/wms/IwaskuLocationsModal';

const logger = createLogger('DepoDashboard');

interface Movement {
  id: string;
  type: string;
  iwasku: string | null;
  quantity: number | null;
  fromShelfId: string | null;
  toShelfId: string | null;
  refType: string | null;
  userId: string;
  createdAt: string;
  notes: string | null;
  reverseOfId: string | null;
  reversedBy: { id: string }[];
}

const UNDOABLE_TYPES = new Set([
  'TRANSFER', 'CROSS_WAREHOUSE_TRANSFER', 'INBOUND_MANUAL', 'INBOUND_FROM_SHIPMENT',
]);

interface AggregateRow {
  iwasku: string;
  fnsku: string | null;
  asin: string | null;
  productName: string | null;
  category: string | null;
  looseQty: number;
  looseShelves: number;
  boxQty: number;
  boxCount: number;
  totalQty: number;
  totalReservedQty: number;
}

type Summary =
  | {
      mode: 'TOTALS_PRIMARY';
      shelfCount: number;
      totalQty: number;
      productCount: number;
      pendingUnmatched: number;
    }
  | {
      mode: 'SHELF_PRIMARY';
      shelfCount: number;
      looseSkuLines: number;
      looseTotalQty: number;
      boxesByStatus: { status: string; count: number; quantity: number }[];
      pendingUnmatched: number;
    };

interface DepoData {
  warehouse: { code: string; name: string; region: string; stockMode: string };
  role: string;
  summary: Summary;
  recentMovements: Movement[];
}

export default function DepoDashboardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  const [data, setData] = useState<DepoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [iwaskuModal, setIwaskuModal] = useState<{ iwasku: string; productName: string | null } | null>(null);
  const [aggregate, setAggregate] = useState<AggregateRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d.data);
        else setError(d.error || 'Veri yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Depo fetch error', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, refreshKey]);

  // Aggregate fetch — sadece SHELF_PRIMARY depoları için
  useEffect(() => {
    if (code === 'ANKARA') return;
    let cancelled = false;
    fetch(`/api/depolar/${code}/iwasku-aggregate`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setAggregate(d.data.rows);
      })
      .catch((e) => logger.error('Aggregate fetch', e));
    return () => { cancelled = true; };
  }, [code, refreshKey]);

  async function undoMovement(movementId: string, type: string) {
    if (!confirm(`${type} hareketi geri alınacak. Onaylıyor musun?`)) return;
    setUndoingId(movementId);
    try {
      const res = await fetch(`/api/depolar/${code}/hareketler/${movementId}/undo`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        alert(d.error || 'Geri alınamadı');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Undo hatası', e);
      alert('Sunucu hatası');
    } finally {
      setUndoingId(null);
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const canUndo = ['OPERATOR', 'MANAGER', 'ADMIN'].includes(data.role);

  // Ankara (TOTALS_PRIMARY): mevcut warehouse-stock UI'sı bu sekmenin tamamı.
  // eskiStok/ilaveStok/cikis girişleri, weekly entries, snapshot'lar — hepsi aynen burada.
  if (data.summary.mode === 'TOTALS_PRIMARY') {
    return <WarehouseStockView />;
  }

  return (
    <div className="space-y-6">
      {/* Prominent arama kutusu — sonraki adımda canlanacak */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="SKU / ürün adı / kategori — alt tabloyu filtreler"
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />
      </div>

      {/* NJ/Showroom — SHELF_PRIMARY view */}
      {data.summary.mode === 'SHELF_PRIMARY' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Layers className="w-4 h-4" /> Raf
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.shelfCount}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Package className="w-4 h-4" /> Tekil ürün
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.looseTotalQty}</p>
              <p className="text-[11px] text-gray-400">{data.summary.looseSkuLines} satır</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Box className="w-4 h-4" /> Koli
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {data.summary.boxesByStatus
                  .filter((b) => b.status === 'SEALED')
                  .reduce((s, x) => s + x.quantity, 0)}
              </p>
              <p className="text-[11px] text-gray-400">
                {data.summary.boxesByStatus
                  .filter((b) => b.status === 'SEALED')
                  .reduce((s, x) => s + x.count, 0)}{' '}
                koli
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <AlertTriangle className="w-4 h-4" /> Eşleşmeyen
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.pendingUnmatched}</p>
              <p className="text-[11px] text-gray-400">mapping bekliyor</p>
            </div>
          </div>

          {/* Ürünler aggregate tablosu — sadece SHELF_PRIMARY */}
          <IwaskuAggregateTable
            rows={aggregate}
            searchTerm={searchTerm}
            onSelect={(iwasku, productName) => setIwaskuModal({ iwasku, productName })}
          />
        </>
      )}

      {/* Son hareketler — her iki mod için */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-medium text-gray-700">Son Hareketler</h3>
        </div>
        {data.recentMovements.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">Henüz hareket yok.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Zaman</th>
                <th className="text-left px-4 py-2">Tip</th>
                <th className="text-left px-4 py-2">SKU</th>
                <th className="text-right px-4 py-2">Adet</th>
                <th className="text-left px-4 py-2">Kaynak</th>
                <th className="text-left px-4 py-2">Not</th>
                {canUndo && <th className="text-right px-4 py-2 w-28">Durum</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentMovements.map((m) => {
                const isReversed = (m.reversedBy?.length ?? 0) > 0;
                const isReversal = m.type === 'REVERSAL';
                const showUndo = canUndo && !isReversed && !isReversal && UNDOABLE_TYPES.has(m.type);
                return (
                <tr key={m.id} className={`text-gray-700 ${isReversed ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(m.createdAt).toLocaleString('tr-TR')}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">{m.type}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.iwasku ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{m.quantity ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{m.refType ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 truncate max-w-[200px]">{m.notes ?? ''}</td>
                  {canUndo && (
                    <td className="px-4 py-2 text-right">
                      {isReversed ? (
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                          Geri alındı
                        </span>
                      ) : isReversal ? (
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                          Reversal
                        </span>
                      ) : showUndo ? (
                        <button
                          onClick={() => undoMovement(m.id, m.type)}
                          disabled={undoingId === m.id}
                          className="text-[11px] text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded disabled:opacity-50"
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
        )}
      </div>

      {/* iwasku konum modal'ı */}
      <IwaskuLocationsModal
        isOpen={!!iwaskuModal}
        warehouseCode={code}
        iwasku={iwaskuModal?.iwasku ?? null}
        productName={iwaskuModal?.productName}
        onClose={() => setIwaskuModal(null)}
      />
    </div>
  );
}

interface IwaskuAggregateTableProps {
  rows: AggregateRow[] | null;
  searchTerm: string;
  onSelect: (iwasku: string, productName: string | null) => void;
}

function IwaskuAggregateTable({ rows, searchTerm, onSelect }: IwaskuAggregateTableProps) {
  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.iwasku.toLowerCase().includes(q) ||
        (r.fnsku ?? '').toLowerCase().includes(q) ||
        (r.asin ?? '').toLowerCase().includes(q) ||
        (r.productName ?? '').toLowerCase().includes(q) ||
        (r.category ?? '').toLowerCase().includes(q)
    );
  }, [rows, searchTerm]);

  if (rows === null) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-6 text-sm text-gray-400 text-center">
        Ürünler yükleniyor…
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          Ürünler ({filtered.length}
          {filtered.length !== rows.length && `/${rows.length}`})
        </h3>
        <span className="text-xs text-gray-500">Bir satıra tıkla → konum dağılımı modal</span>
      </div>
      {filtered.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-400 text-center">Eşleşen ürün yok.</div>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2">SKU (iwasku)</th>
                <th className="text-left px-4 py-2">FNSKU</th>
                <th className="text-left px-4 py-2">ASIN</th>
                <th className="text-left px-4 py-2">Ürün</th>
                <th className="text-right px-4 py-2">Tekil</th>
                <th className="text-right px-4 py-2">Koli</th>
                <th className="text-right px-4 py-2">Toplam</th>
                <th className="text-right px-4 py-2">Rezerve</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r, idx) => (
                <tr
                  key={`${r.iwasku}|${r.fnsku ?? ''}|${idx}`}
                  onClick={() => onSelect(r.iwasku, r.productName)}
                  className="text-gray-700 cursor-pointer hover:bg-blue-50"
                >
                  <td className="px-4 py-2 font-mono text-xs">{r.iwasku}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-gray-600">
                    {r.fnsku ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-gray-600">
                    {r.asin ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-xs truncate max-w-[280px]">
                    {r.productName ?? <span className="text-gray-400">—</span>}
                    {r.category && <span className="ml-2 text-[10px] text-gray-400">{r.category}</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-sm">
                    {r.looseQty}
                    {r.looseShelves > 0 && (
                      <span className="ml-1 text-[10px] text-gray-400">/{r.looseShelves} raf</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-sm">
                    {r.boxQty}
                    {r.boxCount > 0 && (
                      <span className="ml-1 text-[10px] text-gray-400">/{r.boxCount} koli</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">{r.totalQty}</td>
                  <td className="px-4 py-2 text-right text-amber-600">
                    {r.totalReservedQty > 0 ? r.totalReservedQty : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
