'use client';

/**
 * Rafa Yerleştirme — mobile-first.
 * POOL'daki loose stoğu (ShelfStock) raflara dağıtır.
 *
 * 2 adımlı sürekli akış:
 *  1. Ürün tara (etiket/FNSKU/IWASKU/ASIN)
 *     - Serial → qty=1, doğrudan adım 2'ye geç
 *     - Serisiz → QtyPromptModal, adet gir, adım 2'ye geç
 *  2. Hedef raf tara → /raflar?q=<kod> ile eşleşen raf bulunur
 *     - Bulunursa: iwasku-konumlar ile POOL kaydı bulunur, /transfer ile aktarılır
 *     - Bulunamazsa hata
 *  3. Toast + log, state sıfırlanır, sıradaki ürüne geç
 *
 * Aynı manu etiketi (serial) bu session'da iki kez taranamaz (duplicate guard).
 */

import { use, useCallback, useRef, useState } from 'react';
import { Camera, Loader2, Check, AlertCircle, X, ChevronRight } from 'lucide-react';
import { slugToCode, warehouseLabelLong } from '@/lib/warehouseLabels';
import { ContinuousScanner } from '@/components/wms/ContinuousScanner';
import { createLogger } from '@/lib/logger';
import { notify } from '@/lib/ui/notify';

const logger = createLogger('RafaYerlestir');

type Phase = 'product' | 'shelf';

interface ScanLookup {
  iwasku: string;
  name: string | null;
  category: string | null;
  foundBy: 'serial' | 'fnsku' | 'iwasku' | 'asin' | 'ean';
  fnsku: string | null;
  serial: string | null;
}

interface PendingProduct {
  product: ScanLookup;
  qty: number;
}

interface LogRow {
  id: number;
  iwasku: string;
  name: string | null;
  qty: number;
  shelfCode: string;
  status: 'pending' | 'ok' | 'err';
  error?: string;
}

interface QtyPromptState {
  product: ScanLookup;
}

export default function RafaYerlestirPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawParam } = use(params);
  const code = slugToCode(rawParam);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('product');
  const [pending, setPending] = useState<PendingProduct | null>(null);
  const [qtyPrompt, setQtyPrompt] = useState<QtyPromptState | null>(null);
  const [scanStatus, setScanStatus] = useState<'ok' | 'err' | null>(null);
  const [lastFeedback, setLastFeedback] = useState<{ kind: 'ok' | 'err'; text: string; key: number } | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const usedSerials = useRef<Set<string>>(new Set());

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setScanStatus(kind);
    setLastFeedback({ kind, text, key: Date.now() + Math.random() });
    setTimeout(() => setScanStatus(null), 400);
  }, []);

  const handleProductScan = useCallback(
    async (rawCode: string) => {
      try {
        const res = await fetch(`/api/products/scan-lookup?code=${encodeURIComponent(rawCode)}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          flash('err', `Bilinmeyen kod: ${rawCode}`);
          return;
        }
        const product = data.data as ScanLookup;

        // Serial duplicate guard
        if (product.foundBy === 'serial' && product.serial) {
          if (usedSerials.current.has(product.serial)) {
            flash('err', `Bu etiket zaten okundu: ${product.serial}`);
            return;
          }
          usedSerials.current.add(product.serial);
        }

        if (product.foundBy === 'serial') {
          setPending({ product, qty: 1 });
          setPhase('shelf');
          flash('ok', `${product.name ?? product.iwasku} — şimdi raf tara`);
          return;
        }

        // Serisiz → miktar modal'ı
        setQtyPrompt({ product });
      } catch (e) {
        logger.error('scan-lookup', e);
        flash('err', 'Sunucuya ulaşılamadı');
      }
    },
    [flash],
  );

  const doTransfer = useCallback(
    async (current: PendingProduct, shelfCode: string) => {
      if (!code) return;
      const logId = Date.now() + Math.random();
      setLog((prev) => [
        {
          id: logId,
          iwasku: current.product.iwasku,
          name: current.product.name,
          qty: current.qty,
          shelfCode,
          status: 'pending',
        },
        ...prev.slice(0, 19),
      ]);
      setProcessing(true);
      try {
        // 1) Hedef raf: kod → id resolve
        const shelvesRes = await fetch(
          `/api/depolar/${code}/raflar?q=${encodeURIComponent(shelfCode)}`,
        );
        const shelvesData = await shelvesRes.json();
        if (!shelvesRes.ok || !shelvesData.success) {
          throw new Error(shelvesData.error || 'Raf sorgusu başarısız');
        }
        const shelves = (shelvesData.data.shelves as Array<{ id: string; code: string }>) ?? [];
        const exact = shelves.find((s) => s.code.toLowerCase() === shelfCode.toLowerCase());
        const toShelf = exact ?? (shelves.length === 1 ? shelves[0] : null);
        if (!toShelf) {
          throw new Error(`Raf bulunamadı: ${shelfCode}`);
        }

        // 2) POOL'daki ShelfStock id'sini bul
        const locRes = await fetch(
          `/api/depolar/${code}/iwasku-konumlar?iwasku=${encodeURIComponent(current.product.iwasku)}`,
        );
        const locData = await locRes.json();
        if (!locRes.ok || !locData.success) {
          throw new Error(locData.error || 'Konum sorgusu başarısız');
        }
        const stocks = (locData.data.stocks as Array<{
          id: string;
          shelfType: string;
          availableQty: number;
        }>) ?? [];
        const pool = stocks.find((s) => s.shelfType === 'POOL' && s.availableQty >= current.qty);
        if (!pool) {
          const inAny = stocks.find((s) => s.availableQty >= current.qty);
          if (!inAny) {
            throw new Error(`POOL'da yeterli stok yok (${current.product.iwasku})`);
          }
          throw new Error('Ürün POOL dışında — manuel kontrol gerekli');
        }

        // 3) Transfer
        const transRes = await fetch(`/api/depolar/${code}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: { type: 'stock', id: pool.id },
            toShelfId: toShelf.id,
            quantity: current.qty,
            notes: `Mobil rafa yerleştirme → ${toShelf.code}`,
          }),
        });
        const transData = await transRes.json();
        if (!transRes.ok || !transData.success) {
          throw new Error(transData.error || `HTTP ${transRes.status}`);
        }

        // Başarı
        setLog((prev) =>
          prev.map((r) => (r.id === logId ? { ...r, status: 'ok', shelfCode: toShelf.code } : r)),
        );
        flash('ok', `+${current.qty} ${current.product.name ?? current.product.iwasku} → ${toShelf.code} ✓`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Hata';
        logger.error('rafa yerleştir', e);
        setLog((prev) => prev.map((r) => (r.id === logId ? { ...r, status: 'err', error: msg } : r)));
        flash('err', msg);
        notify.error(msg);
      } finally {
        setProcessing(false);
        setPending(null);
        setPhase('product');
      }
    },
    [code, flash],
  );

  const handleShelfScan = useCallback(
    async (rawCode: string) => {
      if (!pending) {
        // Beklenmeyen — state mismatch
        setPhase('product');
        return;
      }
      // Raf kodu: trim
      const shelfCode = rawCode.trim();
      if (!shelfCode) return;
      await doTransfer(pending, shelfCode);
    },
    [pending, doTransfer],
  );

  const handleScan = useCallback(
    async (rawCode: string) => {
      if (processing) return;
      if (phase === 'product') {
        await handleProductScan(rawCode);
      } else {
        await handleShelfScan(rawCode);
      }
    },
    [phase, processing, handleProductScan, handleShelfScan],
  );

  if (!code) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        Bilinmeyen depo: <span className="font-mono">{rawParam}</span>
      </div>
    );
  }

  const hint =
    phase === 'product'
      ? '1/2 — Ürünü kameraya gösterin'
      : `2/2 — Hedef raf etiketini kameraya gösterin (${pending?.product.name ?? pending?.product.iwasku} × ${pending?.qty})`;

  return (
    <div className="-mx-4 -my-2 md:mx-0 md:my-0 max-w-md md:mx-auto bg-gray-50 min-h-[80vh]">
      {/* Üst */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Rafa Yerleştirme</div>
            <div className="text-sm font-semibold text-gray-900">{warehouseLabelLong(code)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Yerleştirilen</div>
            <div className="text-sm font-semibold text-gray-900">
              {log.filter((r) => r.status === 'ok').reduce((s, r) => s + r.qty, 0)} adet
            </div>
          </div>
        </div>
      </div>

      {/* Mevcut adım göstergesi */}
      {pending && (
        <div className="px-4 pt-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
            <div className="flex-1">
              <div className="text-xs text-blue-700 font-medium">Bekleyen ürün</div>
              <div className="text-sm font-semibold text-blue-900 truncate">
                {pending.product.name ?? pending.product.iwasku} × {pending.qty}
              </div>
              <div className="text-[11px] text-blue-600 mt-0.5">
                Şimdi hedef rafı tarayın
              </div>
            </div>
            <button
              onClick={() => {
                setPending(null);
                setPhase('product');
                flash('err', 'İptal edildi');
              }}
              className="p-2 text-blue-600 hover:text-blue-900"
              title="Vazgeç"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Log */}
      <div className="px-4 py-3 space-y-2 pb-24">
        {log.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            <Camera className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            Henüz yerleştirme yok.
            <br />
            Aşağıdaki butonla başlayın.
          </div>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1">
              Son yerleştirmeler
            </div>
            {log.map((row) => (
              <div
                key={row.id}
                className={`bg-white border rounded-lg p-3 flex items-center gap-3 ${
                  row.status === 'err' ? 'border-red-300' : 'border-gray-200'
                }`}
              >
                <div className="flex-shrink-0">
                  {row.status === 'pending' && <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />}
                  {row.status === 'ok' && <Check className="w-5 h-5 text-emerald-600" />}
                  {row.status === 'err' && <AlertCircle className="w-5 h-5 text-red-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-gray-500">{row.iwasku}</div>
                  <div className="text-sm text-gray-900 truncate" title={row.name ?? undefined}>
                    {row.name ?? '(isimsiz)'}
                  </div>
                  {row.status === 'err' && row.error && (
                    <div className="text-xs text-red-600 mt-0.5">{row.error}</div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-1">
                    +{row.qty}
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                    <span className="font-mono text-xs">{row.shelfCode}</span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Alt: Tara */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 max-w-md md:mx-auto z-10">
        <button
          onClick={() => setScannerOpen(true)}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-4 rounded-lg hover:bg-blue-700 text-base"
        >
          <Camera className="w-5 h-5" />
          {phase === 'product' ? 'Ürün Tara' : 'Hedef Raf Tara'}
        </button>
      </div>

      <ContinuousScanner
        open={scannerOpen}
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
        status={scanStatus}
        hint={hint}
        paused={qtyPrompt !== null || processing}
        lastFeedback={lastFeedback}
      />

      {qtyPrompt && (
        <QtyPromptModal
          product={qtyPrompt.product}
          onConfirm={(qty) => {
            const product = qtyPrompt.product;
            setQtyPrompt(null);
            setPending({ product, qty });
            setPhase('shelf');
            flash('ok', `${product.name ?? product.iwasku} × ${qty} — şimdi raf tara`);
          }}
          onCancel={() => setQtyPrompt(null)}
        />
      )}
    </div>
  );
}

// --- Miktar sor modal (raf seçimi YOK — bu sayfada raf taraması ayrı adım) ---

interface QtyPromptProps {
  product: ScanLookup;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
}

function QtyPromptModal({ product, onConfirm, onCancel }: QtyPromptProps) {
  const [qty, setQty] = useState<string>('1');

  const submit = () => {
    const n = parseInt(qty, 10);
    onConfirm(Number.isFinite(n) && n > 0 ? n : 1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl md:rounded-xl shadow-2xl">
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">
            {product.foundBy === 'fnsku'
              ? 'FNSKU okundu'
              : product.foundBy === 'asin'
              ? 'ASIN okundu'
              : product.foundBy === 'ean'
              ? 'EAN okundu'
              : 'Ürün'}
          </div>
          <div className="text-sm font-mono text-gray-700 mt-0.5">{product.iwasku}</div>
          <div className="text-base font-semibold text-gray-900 mt-1">
            {product.name ?? '(isimsiz)'}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="p-4 space-y-4"
        >
          <label className="block">
            <span className="text-xs text-gray-500">Adet</span>
            <input
              autoFocus
              type="number"
              min="1"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="mt-1 w-full text-2xl font-bold text-center px-3 py-3 border-2 border-blue-500 rounded-lg"
            />
          </label>

          <div className="grid grid-cols-4 gap-2">
            {[1, 5, 10, 20].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setQty(String(n))}
                className={`py-2 rounded-lg text-sm font-medium border ${
                  qty === String(n)
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50"
            >
              İptal
            </button>
            <button
              type="submit"
              className="flex-[2] py-3 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700"
            >
              Devam
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
