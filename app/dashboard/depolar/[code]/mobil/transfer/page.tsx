'use client';

/**
 * Raf → Raf Transfer — mobile-first.
 *
 * 2 adımlı akış (kaynak raf otomatik bulunur):
 *  1. Ürün tara → iwasku-konumlar'dan o ürünün bulunduğu raflar
 *     - Tek raf → otomatik kaynak set
 *     - Birden fazla raf → SourcePickerModal (kullanıcı seçer)
 *  2. Hedef raf tara → /transfer POST
 *
 * Faz 2 (POOL → Raf) ile farkı: kaynak raf herhangi bir raf olabilir
 * (POOL/NORMAL/TEMP dahil), POOL'a bağlı kalmaz.
 */

import { use, useCallback, useRef, useState } from 'react';
import { Camera, Loader2, Check, AlertCircle, X, ChevronRight, MapPin } from 'lucide-react';
import { slugToCode, warehouseLabelLong } from '@/lib/warehouseLabels';
import { ContinuousScanner } from '@/components/wms/ContinuousScanner';
import { createLogger } from '@/lib/logger';
import { notify } from '@/lib/ui/notify';

const logger = createLogger('Transfer');

type Phase = 'product' | 'shelf';

interface ScanLookup {
  iwasku: string;
  name: string | null;
  foundBy: 'serial' | 'fnsku' | 'iwasku' | 'asin' | 'ean';
  serial: string | null;
}

interface StockLocation {
  id: string; // ShelfStock id
  shelfId: string;
  shelfCode: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
  quantity: number;
  reservedQty: number;
  availableQty: number;
}

interface PendingTransfer {
  product: ScanLookup;
  qty: number;
  source: StockLocation;
}

interface LogRow {
  id: number;
  iwasku: string;
  name: string | null;
  qty: number;
  fromShelfCode: string;
  toShelfCode: string;
  status: 'pending' | 'ok' | 'err';
  error?: string;
}

interface QtyPromptState {
  product: ScanLookup;
}

interface SourcePickerState {
  product: ScanLookup;
  qty: number;
  locations: StockLocation[];
}

export default function TransferPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawParam } = use(params);
  const code = slugToCode(rawParam);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('product');
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [qtyPrompt, setQtyPrompt] = useState<QtyPromptState | null>(null);
  const [sourcePicker, setSourcePicker] = useState<SourcePickerState | null>(null);
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

  // Ortak: ürün + qty bilindiğinde konumları çek, kaynak rafı belirle
  const resolveSource = useCallback(
    async (product: ScanLookup, qty: number) => {
      if (!code) return;
      try {
        const res = await fetch(
          `/api/depolar/${code}/iwasku-konumlar?iwasku=${encodeURIComponent(product.iwasku)}`,
        );
        const data = await res.json();
        if (!res.ok || !data.success) {
          flash('err', data.error || 'Konum sorgusu başarısız');
          return;
        }
        const stocks = (data.data.stocks as StockLocation[]) ?? [];
        const eligible = stocks.filter((s) => s.availableQty >= qty);
        if (eligible.length === 0) {
          flash('err', `Bu depoda ${qty} adetlik kaynak yok: ${product.iwasku}`);
          return;
        }
        if (eligible.length === 1) {
          setPending({ product, qty, source: eligible[0] });
          setPhase('shelf');
          flash('ok', `${product.name ?? product.iwasku} × ${qty} (${eligible[0].shelfCode}) — şimdi hedef raf tara`);
          return;
        }
        // Birden fazla raf → picker
        setSourcePicker({ product, qty, locations: eligible });
      } catch (e) {
        logger.error('iwasku-konumlar', e);
        flash('err', 'Sunucuya ulaşılamadı');
      }
    },
    [code, flash],
  );

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

        // Manu seri etiketi: 1 adet sabit + duplicate guard
        if (product.foundBy === 'serial') {
          if (product.serial && usedSerials.current.has(product.serial)) {
            flash('err', `Bu etiket zaten okundu: ${product.serial}`);
            return;
          }
          if (product.serial) usedSerials.current.add(product.serial);
          await resolveSource(product, 1);
          return;
        }

        // Serisiz → miktar modal'ı
        setQtyPrompt({ product });
      } catch (e) {
        logger.error('scan-lookup', e);
        flash('err', 'Sunucuya ulaşılamadı');
      }
    },
    [flash, resolveSource],
  );

  const doTransfer = useCallback(
    async (current: PendingTransfer, shelfCode: string) => {
      if (!code) return;
      const logId = Date.now() + Math.random();
      setLog((prev) => [
        {
          id: logId,
          iwasku: current.product.iwasku,
          name: current.product.name,
          qty: current.qty,
          fromShelfCode: current.source.shelfCode,
          toShelfCode: shelfCode,
          status: 'pending',
        },
        ...prev.slice(0, 19),
      ]);
      setProcessing(true);
      try {
        // Hedef raf: kod → id
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
        if (toShelf.id === current.source.shelfId) {
          throw new Error('Hedef ve kaynak aynı raf');
        }

        // Transfer
        const transRes = await fetch(`/api/depolar/${code}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: { type: 'stock', id: current.source.id },
            toShelfId: toShelf.id,
            quantity: current.qty,
            notes: `Mobil transfer: ${current.source.shelfCode} → ${toShelf.code}`,
          }),
        });
        const transData = await transRes.json();
        if (!transRes.ok || !transData.success) {
          throw new Error(transData.error || `HTTP ${transRes.status}`);
        }

        setLog((prev) =>
          prev.map((r) =>
            r.id === logId ? { ...r, status: 'ok', toShelfCode: toShelf.code } : r,
          ),
        );
        flash(
          'ok',
          `+${current.qty} ${current.product.name ?? current.product.iwasku} → ${toShelf.code} ✓`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Hata';
        logger.error('transfer', e);
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
        setPhase('product');
        return;
      }
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
      : `2/2 — Hedef raf etiketini kameraya gösterin (${pending?.product.name ?? pending?.product.iwasku} × ${pending?.qty}, kaynak: ${pending?.source.shelfCode})`;

  return (
    <div className="-mx-4 -my-2 md:mx-0 md:my-0 max-w-md md:mx-auto bg-gray-50 min-h-[80vh]">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Raf → Raf Transfer</div>
            <div className="text-sm font-semibold text-gray-900">{warehouseLabelLong(code)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Aktarılan</div>
            <div className="text-sm font-semibold text-gray-900">
              {log.filter((r) => r.status === 'ok').reduce((s, r) => s + r.qty, 0)} adet
            </div>
          </div>
        </div>
      </div>

      {pending && (
        <div className="px-4 pt-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
            <div className="flex-1">
              <div className="text-xs text-blue-700 font-medium">Bekleyen aktarım</div>
              <div className="text-sm font-semibold text-blue-900 truncate">
                {pending.product.name ?? pending.product.iwasku} × {pending.qty}
              </div>
              <div className="text-[11px] text-blue-600 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Kaynak: <span className="font-mono">{pending.source.shelfCode}</span>
                <ChevronRight className="w-3 h-3" />
                <span className="italic">hedef rafı tarayın</span>
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

      <div className="px-4 py-3 space-y-2 pb-24">
        {log.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            <Camera className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            Henüz transfer yok.
            <br />
            Aşağıdaki butonla başlayın.
          </div>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1">
              Son transferler
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
                    <span className="font-mono text-xs">{row.fromShelfCode}</span>
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                    <span className="font-mono text-xs">{row.toShelfCode}</span>
                  </div>
                  <div className="text-[11px] text-gray-500">×{row.qty}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

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
        paused={qtyPrompt !== null || sourcePicker !== null || processing}
        lastFeedback={lastFeedback}
      />

      {qtyPrompt && (
        <QtyPromptModal
          product={qtyPrompt.product}
          onConfirm={async (qty) => {
            const product = qtyPrompt.product;
            setQtyPrompt(null);
            await resolveSource(product, qty);
          }}
          onCancel={() => setQtyPrompt(null)}
        />
      )}

      {sourcePicker && (
        <SourcePickerModal
          state={sourcePicker}
          onSelect={(loc) => {
            setPending({ product: sourcePicker.product, qty: sourcePicker.qty, source: loc });
            setPhase('shelf');
            setSourcePicker(null);
            flash('ok', `Kaynak: ${loc.shelfCode} — şimdi hedef raf tara`);
          }}
          onCancel={() => setSourcePicker(null)}
        />
      )}
    </div>
  );
}

// --- Modaller ---

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
            {product.foundBy === 'fnsku' ? 'FNSKU okundu' : product.foundBy === 'asin' ? 'ASIN okundu' : 'Ürün'}
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
            <span className="text-xs text-gray-500">Aktarılacak Adet</span>
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

interface SourcePickerProps {
  state: SourcePickerState;
  onSelect: (loc: StockLocation) => void;
  onCancel: () => void;
}

function SourcePickerModal({ state, onSelect, onCancel }: SourcePickerProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl md:rounded-xl shadow-2xl">
        <div className="px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Kaynak Raf Seç</div>
            <div className="text-sm font-mono text-gray-700">{state.product.iwasku}</div>
            <div className="text-base font-semibold text-gray-900">
              {state.product.name ?? '(isimsiz)'} × {state.qty}
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
          {state.locations
            .slice()
            .sort((a, b) => b.availableQty - a.availableQty)
            .map((loc) => (
              <button
                key={loc.id}
                onClick={() => onSelect(loc)}
                className="w-full bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  <span className="font-mono text-sm font-semibold">{loc.shelfCode}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">{loc.shelfType}</span>
                </div>
                <div className="text-sm font-semibold text-gray-900">{loc.availableQty} adet</div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
