'use client';

/**
 * Stok Kabul — mobile-first sayfa.
 * Telefon kamerasıyla FNSKU/IWASKU tarayıp ShelfStock'a (loose) ekler.
 * Hedef raf opsiyonel; boşsa POOL'a düşer.
 *
 * Akış:
 *  1. (opsiyonel) Hedef raf seç (manuel pick) — boşsa POOL
 *  2. "Tara"ya bas → ContinuousScanner sürekli açık
 *  3. FNSKU/IWASKU okudukça /api/products/scan-lookup → ürün listeye eklenir veya qty++
 *  4. "Kaydet"e bas → her satır için POST /api/depolar/[code]/tekil
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { notify } from '@/lib/ui/notify';
import { Camera, Loader2, Plus, Minus, Trash2, MapPin, X, Save, Search } from 'lucide-react';
import { slugToCode, warehouseLabelLong } from '@/lib/warehouseLabels';
import { ContinuousScanner } from '@/components/wms/ContinuousScanner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('StokKabul');

interface ScanLookup {
  iwasku: string;
  name: string | null;
  category: string | null;
  foundBy: 'fnsku' | 'iwasku' | 'ean';
  fnsku: string | null;
}

interface CartRow {
  iwasku: string;
  name: string | null;
  fnsku: string | null;
  foundBy: ScanLookup['foundBy'];
  qty: number;
}

interface ShelfLite {
  id: string;
  code: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
}

export default function StokKabulPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawParam } = use(params);
  const code = slugToCode(rawParam);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState<'ok' | 'err' | null>(null);
  const [cart, setCart] = useState<CartRow[]>([]);
  const [targetShelf, setTargetShelf] = useState<ShelfLite | null>(null);
  const [shelfModalOpen, setShelfModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const totalQty = useMemo(() => cart.reduce((s, r) => s + r.qty, 0), [cart]);

  const handleScan = useCallback(
    async (rawCode: string) => {
      try {
        const res = await fetch(`/api/products/scan-lookup?code=${encodeURIComponent(rawCode)}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          setScanStatus('err');
          notify.error(`Bilinmeyen kod: ${rawCode}`);
          setTimeout(() => setScanStatus(null), 400);
          return;
        }
        const product = data.data as ScanLookup;
        setCart((prev) => {
          const existing = prev.find((r) => r.iwasku === product.iwasku);
          if (existing) {
            return prev.map((r) =>
              r.iwasku === product.iwasku ? { ...r, qty: r.qty + 1 } : r,
            );
          }
          return [
            ...prev,
            {
              iwasku: product.iwasku,
              name: product.name,
              fnsku: product.fnsku,
              foundBy: product.foundBy,
              qty: 1,
            },
          ];
        });
        setScanStatus('ok');
        setTimeout(() => setScanStatus(null), 400);
      } catch (e) {
        logger.error('scan-lookup error', e);
        setScanStatus('err');
        notify.error('Sunucuya ulaşılamadı');
        setTimeout(() => setScanStatus(null), 400);
      }
    },
    [],
  );

  const incrementQty = (iwasku: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((r) => (r.iwasku === iwasku ? { ...r, qty: Math.max(0, r.qty + delta) } : r))
        .filter((r) => r.qty > 0),
    );
  };

  const removeRow = (iwasku: string) => {
    setCart((prev) => prev.filter((r) => r.iwasku !== iwasku));
  };

  const handleSave = async () => {
    if (!code) return;
    if (cart.length === 0) {
      notify.error('Liste boş');
      return;
    }
    setSaving(true);
    try {
      const results = await Promise.allSettled(
        cart.map((row) =>
          fetch(`/api/depolar/${code}/tekil`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              iwasku: row.iwasku,
              quantity: row.qty,
              targetShelfId: targetShelf?.id,
              notes: `Stok kabul${targetShelf ? ` → ${targetShelf.code}` : ' (POOL)'}`,
            }),
          }).then((r) => r.json()),
        ),
      );
      const failedIndexes: number[] = [];
      results.forEach((res, idx) => {
        if (res.status === 'rejected' || !res.value?.success) {
          failedIndexes.push(idx);
        }
      });
      if (failedIndexes.length === 0) {
        notify.success(`${cart.length} ürün, ${totalQty} adet kaydedildi`);
        setCart([]);
      } else {
        const failed = failedIndexes.map((i) => cart[i]);
        setCart(failed);
        notify.error(`${failedIndexes.length} satır kaydedilemedi, listede bırakıldı`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!code) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        Bilinmeyen depo: <span className="font-mono">{rawParam}</span>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-2 md:mx-0 md:my-0 max-w-md md:mx-auto bg-gray-50 min-h-[80vh]">
      {/* Üst durum şeridi */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Stok Kabul</div>
            <div className="text-sm font-semibold text-gray-900">{warehouseLabelLong(code)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Toplam</div>
            <div className="text-sm font-semibold text-gray-900">{cart.length} ürün · {totalQty} adet</div>
          </div>
        </div>
        <button
          onClick={() => setShelfModalOpen(true)}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm hover:bg-gray-100"
        >
          <span className="flex items-center gap-2 text-gray-700">
            <MapPin className="w-4 h-4 text-gray-500" />
            <span className="text-xs">Hedef Raf:</span>
            <span className="font-medium">
              {targetShelf ? targetShelf.code : 'POOL (varsayılan)'}
            </span>
          </span>
          <span className="text-xs text-blue-700">Değiştir</span>
        </button>
      </div>

      {/* Sepet listesi */}
      <div className="px-4 py-3 space-y-2 pb-32">
        {cart.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            <Camera className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            Henüz tarama yok.
            <br />
            Aşağıdaki butonla kamerayı aç.
          </div>
        ) : (
          cart.map((row) => (
            <div key={row.iwasku} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-gray-500">
                  {row.iwasku}
                  {row.foundBy === 'fnsku' && row.fnsku && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                      FNSKU
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-900 truncate" title={row.name ?? undefined}>
                  {row.name ?? '(isimsiz)'}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => incrementQty(row.iwasku, -1)}
                  className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded text-gray-700 hover:bg-gray-200"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min="1"
                  value={row.qty}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 0;
                    setCart((prev) => prev.map((r) => (r.iwasku === row.iwasku ? { ...r, qty: Math.max(0, v) } : r)).filter((r) => r.qty > 0));
                  }}
                  className="w-12 text-center border border-gray-300 rounded text-sm py-1 font-semibold"
                />
                <button
                  onClick={() => incrementQty(row.iwasku, +1)}
                  className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded text-gray-700 hover:bg-gray-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => removeRow(row.iwasku)}
                  className="ml-1 w-8 h-8 flex items-center justify-center text-red-600 hover:bg-red-50 rounded"
                  title="Sil"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Alt: aksiyon barı */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 flex items-center gap-2 max-w-md md:mx-auto z-10">
        <button
          onClick={() => setScannerOpen(true)}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-medium py-3 rounded-lg hover:bg-blue-700"
        >
          <Camera className="w-5 h-5" />
          Tara
        </button>
        <button
          onClick={handleSave}
          disabled={saving || cart.length === 0}
          className="flex items-center justify-center gap-2 bg-emerald-600 text-white font-medium py-3 px-5 rounded-lg hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          Kaydet
        </button>
      </div>

      <ContinuousScanner
        open={scannerOpen}
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
        status={scanStatus}
        hint="FNSKU veya IWASKU barkodunu kameraya gösterin"
      />

      {shelfModalOpen && (
        <ShelfPickerModal
          warehouseCode={code}
          current={targetShelf}
          onSelect={(s) => {
            setTargetShelf(s);
            setShelfModalOpen(false);
          }}
          onClear={() => {
            setTargetShelf(null);
            setShelfModalOpen(false);
          }}
          onClose={() => setShelfModalOpen(false)}
        />
      )}
    </div>
  );
}

// --- Raf seç modal ---

interface ShelfPickerProps {
  warehouseCode: string;
  current: ShelfLite | null;
  onSelect: (shelf: ShelfLite) => void;
  onClear: () => void;
  onClose: () => void;
}

function ShelfPickerModal({ warehouseCode, current, onSelect, onClear, onClose }: ShelfPickerProps) {
  const [q, setQRaw] = useState('');
  const [shelves, setShelves] = useState<ShelfLite[]>([]);
  const [loading, setLoading] = useState(true);

  const setQ = (next: string) => {
    setQRaw(next);
    setLoading(true);
  };

  useEffect(() => {
    let cancelled = false;
    const url = `/api/depolar/${warehouseCode}/raflar${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          const list = (data.data.shelves as Array<{ id: string; code: string; shelfType: ShelfLite['shelfType'] }>) ?? [];
          setShelves(list);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouseCode, q]);

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full max-w-md max-h-[80vh] rounded-t-xl md:rounded-xl flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Hedef Raf Seç</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Raf kodu ara (örn. A1-2)"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <button
            onClick={onClear}
            className="mt-2 w-full text-xs text-gray-600 hover:text-gray-900 py-1.5 border border-gray-200 rounded"
          >
            POOL (varsayılan) — raf seçimi kaldır
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : shelves.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">Raf yok</div>
          ) : (
            <ul className="space-y-1">
              {shelves.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => onSelect(s)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between hover:bg-blue-50 ${
                      current?.id === s.id ? 'bg-blue-100 text-blue-900' : 'text-gray-800'
                    }`}
                  >
                    <span className="font-mono">{s.code}</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">{s.shelfType}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
