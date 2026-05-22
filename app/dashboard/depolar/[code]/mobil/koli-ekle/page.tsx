'use client';

/**
 * Koli Ekle — mobile-first.
 *
 * Akış:
 *  1. Koli QR/barkod tara → boxNumber çözümle
 *     - shipment-boxes/by-number ile içerik çek
 *     - Bulundu → onay kart (qty düzenlenebilir)
 *     - Bulunamadı → manuel giriş paneli (ürün tara + qty + marketplace)
 *  2. Hedef raf tara (veya manuel pick)
 *  3. POST /api/depolar/[code]/koli → ShipmentBox synthetic + ShelfBox + INBOUND_MANUAL
 */

import { use, useCallback, useEffect, useState } from 'react';
import {
  Camera, Loader2, Check, AlertCircle, X, MapPin, Edit3, Package,
} from 'lucide-react';
import { slugToCode, warehouseLabelLong } from '@/lib/warehouseLabels';
import { ContinuousScanner } from '@/components/wms/ContinuousScanner';
import { createLogger } from '@/lib/logger';
import { notify } from '@/lib/ui/notify';

const logger = createLogger('KoliEkle');

interface BoxLookup {
  boxNumber: string;
  iwasku: string | null;
  fnsku: string | null;
  productName: string | null;
  productCategory: string | null;
  quantity: number;
  destination: string;
  marketplaceCode: string | null;
  shipment: { id: string; name: string; destinationTab: string; status: string };
}

interface ScanLookup {
  iwasku: string;
  name: string | null;
  foundBy: 'serial' | 'fnsku' | 'iwasku' | 'asin' | 'ean';
  fnsku: string | null;
}

interface Pending {
  // Otomatik yol (manumaestro koli)
  fromShipment?: BoxLookup;
  // Manuel yol
  manual?: {
    iwasku: string;
    productName: string | null;
    fnsku: string | null;
  };
  // Düzenlenebilir alanlar
  qty: number;
  marketplaceCode: string;
  destination: 'FBA' | 'DEPO';
  boxNumber?: string;
}

interface LogRow {
  id: number;
  label: string; // boxNumber veya iwasku
  detail: string;
  qty: number;
  shelfCode: string;
  status: 'pending' | 'ok' | 'err';
  error?: string;
}

interface Marketplace {
  id: string;
  code: string;
  name: string;
}

interface ShelfLite {
  id: string;
  code: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
}

type Phase = 'box' | 'shelf';

const BOX_NUMBER_RE = /^\d+-\d{3,4}$/;

export default function KoliEklePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawParam } = use(params);
  const code = slugToCode(rawParam);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('box');
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState<'ok' | 'err' | null>(null);
  const [lastFeedback, setLastFeedback] = useState<{ kind: 'ok' | 'err'; text: string; key: number } | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);

  useEffect(() => {
    fetch('/api/marketplaces')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setMarketplaces(d.data as Marketplace[]);
      })
      .catch(() => {});
  }, []);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setScanStatus(kind);
    setLastFeedback({ kind, text, key: Date.now() + Math.random() });
    setTimeout(() => setScanStatus(null), 400);
  }, []);

  // 1. adım: boxNumber tarama (veya FNSKU/IWASKU manuel girişine geçiş)
  const handleBoxScan = useCallback(
    async (raw: string) => {
      const v = raw.trim();
      if (!v) return;

      // boxNumber formatı? (örn 71-1011)
      if (BOX_NUMBER_RE.test(v)) {
        try {
          const r = await fetch(`/api/shipment-boxes/by-number?n=${encodeURIComponent(v)}`);
          const d = await r.json();
          if (r.ok && d.success) {
            const lookup = d.data as BoxLookup;
            setPending({
              fromShipment: lookup,
              qty: lookup.quantity,
              marketplaceCode: lookup.marketplaceCode ?? '',
              destination: (lookup.destination === 'FBA' ? 'FBA' : 'DEPO'),
              boxNumber: lookup.boxNumber,
            });
            setConfirmOpen(true);
            flash('ok', `${lookup.boxNumber} — ${lookup.productName ?? lookup.iwasku}`);
            return;
          }
          // 404 → bilinmeyen koli, manuel geçiş
          flash('err', `Sistemde yok: ${v} — manuel giriş`);
          setManualOpen(true);
          return;
        } catch (e) {
          logger.error('by-number', e);
          flash('err', 'Sunucuya ulaşılamadı');
          return;
        }
      }

      // boxNumber formatı değil — FNSKU/IWASKU/ASIN olabilir, manuel akışta scan-lookup'a yönlendir
      try {
        const r = await fetch(`/api/products/scan-lookup?code=${encodeURIComponent(v)}`);
        const d = await r.json();
        if (r.ok && d.success) {
          const p = d.data as ScanLookup;
          setPending({
            manual: { iwasku: p.iwasku, productName: p.name, fnsku: p.fnsku },
            qty: 1,
            marketplaceCode: '',
            destination: 'DEPO',
          });
          setManualOpen(true);
          flash('ok', `${p.name ?? p.iwasku} — bilgileri doldur`);
          return;
        }
        flash('err', `Bilinmeyen kod: ${v}`);
      } catch (e) {
        logger.error('scan-lookup', e);
        flash('err', 'Sunucuya ulaşılamadı');
      }
    },
    [flash],
  );

  // 2. adım: hedef raf tarama → POST
  const doSubmit = useCallback(
    async (cur: Pending, shelfCode: string) => {
      if (!code) return;
      const iwasku = cur.fromShipment?.iwasku ?? cur.manual?.iwasku ?? null;
      const productName = cur.fromShipment?.productName ?? cur.manual?.productName ?? null;
      if (!iwasku) {
        flash('err', 'Ürün bilgisi eksik');
        return;
      }
      const logId = Date.now() + Math.random();
      setLog((prev) => [
        {
          id: logId,
          label: cur.boxNumber ?? iwasku,
          detail: productName ?? iwasku,
          qty: cur.qty,
          shelfCode,
          status: 'pending',
        },
        ...prev.slice(0, 19),
      ]);
      setProcessing(true);

      try {
        // Hedef raf
        const rRes = await fetch(`/api/depolar/${code}/raflar?q=${encodeURIComponent(shelfCode)}`);
        const rData = await rRes.json();
        if (!rRes.ok || !rData.success) throw new Error(rData.error || 'Raf sorgusu başarısız');
        const shelves = (rData.data.shelves as ShelfLite[]) ?? [];
        const exact = shelves.find((s) => s.code.toLowerCase() === shelfCode.toLowerCase());
        const toShelf = exact ?? (shelves.length === 1 ? shelves[0] : null);
        if (!toShelf) throw new Error(`Raf bulunamadı: ${shelfCode}`);

        // POST koli
        const body: Record<string, unknown> = {
          iwasku,
          quantity: cur.qty,
          marketplaceCode: cur.marketplaceCode || 'DEPO',
          destination: cur.destination,
          targetShelfId: toShelf.id,
          notes: cur.fromShipment
            ? `Mobil koli ekle: ${cur.boxNumber}`
            : `Mobil koli ekle (manuel)`,
        };
        if (cur.boxNumber) body.boxNumber = cur.boxNumber;

        const res = await fetch(`/api/depolar/${code}/koli`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

        setLog((prev) =>
          prev.map((r) => (r.id === logId ? { ...r, status: 'ok', shelfCode: toShelf.code } : r)),
        );
        flash('ok', `+${cur.qty} ${productName ?? iwasku} → ${toShelf.code} ✓`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Hata';
        logger.error('koli POST', e);
        setLog((prev) => prev.map((r) => (r.id === logId ? { ...r, status: 'err', error: msg } : r)));
        flash('err', msg);
        notify.error(msg);
      } finally {
        setProcessing(false);
        setPending(null);
        setPhase('box');
      }
    },
    [code, flash],
  );

  const handleShelfScan = useCallback(
    async (raw: string) => {
      if (!pending) {
        setPhase('box');
        return;
      }
      const sc = raw.trim();
      if (!sc) return;
      await doSubmit(pending, sc);
    },
    [pending, doSubmit],
  );

  const handleScan = useCallback(
    async (raw: string) => {
      if (processing) return;
      if (phase === 'box') {
        await handleBoxScan(raw);
      } else {
        await handleShelfScan(raw);
      }
    },
    [phase, processing, handleBoxScan, handleShelfScan],
  );

  if (!code) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        Bilinmeyen depo: <span className="font-mono">{rawParam}</span>
      </div>
    );
  }

  const hint =
    phase === 'box'
      ? 'Koli QR\'ını veya FNSKU/IWASKU barkodunu gösterin'
      : `Hedef raf etiketini gösterin — ${pending?.boxNumber ?? pending?.manual?.iwasku} × ${pending?.qty}`;

  return (
    <div className="-mx-4 -my-2 md:mx-0 md:my-0 max-w-md md:mx-auto bg-gray-50 min-h-[80vh]">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Koli Ekle</div>
            <div className="text-sm font-semibold text-gray-900">{warehouseLabelLong(code)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase text-gray-500 tracking-wide">Eklendi</div>
            <div className="text-sm font-semibold text-gray-900">
              {log.filter((r) => r.status === 'ok').length} koli
            </div>
          </div>
        </div>
      </div>

      {pending && phase === 'shelf' && (
        <div className="px-4 pt-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
            <div className="flex-1">
              <div className="text-xs text-blue-700 font-medium">Bekleyen koli</div>
              <div className="text-sm font-semibold text-blue-900 truncate">
                {pending.boxNumber ?? pending.manual?.iwasku} —{' '}
                {pending.fromShipment?.productName ?? pending.manual?.productName ?? '(isimsiz)'}
              </div>
              <div className="text-[11px] text-blue-600 mt-0.5">
                {pending.qty} adet · {pending.marketplaceCode || '—'} · {pending.destination} · şimdi raf tara
              </div>
            </div>
            <button
              onClick={() => {
                setPending(null);
                setPhase('box');
                flash('err', 'İptal edildi');
              }}
              className="p-2 text-blue-600 hover:text-blue-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-3 space-y-2 pb-24">
        {log.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            Henüz koli yok.
            <br />
            Aşağıdaki butonla koliyi tarayın.
          </div>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1">
              Son koliler
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
                  <div className="text-xs font-mono text-gray-500">{row.label}</div>
                  <div className="text-sm text-gray-900 truncate" title={row.detail}>
                    {row.detail}
                  </div>
                  {row.status === 'err' && row.error && (
                    <div className="text-xs text-red-600 mt-0.5">{row.error}</div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-medium text-gray-900">×{row.qty}</div>
                  <div className="text-[11px] text-gray-500 font-mono">{row.shelfCode}</div>
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
          {phase === 'box' ? 'Koli Tara' : 'Hedef Raf Tara'}
        </button>
      </div>

      <ContinuousScanner
        open={scannerOpen}
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
        status={scanStatus}
        hint={hint}
        paused={confirmOpen || manualOpen || processing}
        lastFeedback={lastFeedback}
      />

      {confirmOpen && pending?.fromShipment && (
        <ConfirmBoxModal
          pending={pending}
          marketplaces={marketplaces}
          onConfirm={(updated) => {
            setPending(updated);
            setConfirmOpen(false);
            setPhase('shelf');
            flash('ok', `${updated.fromShipment!.boxNumber} × ${updated.qty} — şimdi raf tara`);
          }}
          onCancel={() => {
            setConfirmOpen(false);
            setPending(null);
          }}
        />
      )}

      {manualOpen && (
        <ManualBoxModal
          initial={pending}
          marketplaces={marketplaces}
          onConfirm={(updated) => {
            setPending(updated);
            setManualOpen(false);
            setPhase('shelf');
            flash('ok', `${updated.manual?.iwasku} × ${updated.qty} — şimdi raf tara`);
          }}
          onCancel={() => {
            setManualOpen(false);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

// --- Modaller ---

interface ConfirmBoxProps {
  pending: Pending;
  marketplaces: Marketplace[];
  onConfirm: (updated: Pending) => void;
  onCancel: () => void;
}

function ConfirmBoxModal({ pending, marketplaces, onConfirm, onCancel }: ConfirmBoxProps) {
  const ship = pending.fromShipment!;
  const [qty, setQty] = useState(String(pending.qty));
  const [mp, setMp] = useState(pending.marketplaceCode);
  const [dest, setDest] = useState<'FBA' | 'DEPO'>(pending.destination);

  const submit = () => {
    const n = parseInt(qty, 10);
    onConfirm({
      ...pending,
      qty: Number.isFinite(n) && n > 0 ? n : 1,
      marketplaceCode: mp,
      destination: dest,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl md:rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-blue-600" />
            <div className="text-[11px] uppercase tracking-wide text-blue-700">Sistemden bulundu</div>
          </div>
          <div className="text-base font-bold text-gray-900 mt-1">{ship.boxNumber}</div>
          <div className="text-xs font-mono text-gray-500 mt-0.5">{ship.iwasku}</div>
          <div className="text-sm font-semibold text-gray-900 mt-1">{ship.productName ?? '(isimsiz)'}</div>
          <div className="text-[11px] text-gray-500 mt-1">
            Sevkiyat: <span className="font-medium">{ship.shipment.name}</span> · {ship.shipment.destinationTab}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="p-4 space-y-3"
        >
          <label className="block">
            <span className="text-xs text-gray-500">Adet</span>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="mt-1 w-full text-xl font-bold text-center px-3 py-2 border-2 border-blue-500 rounded-lg"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-gray-500">Pazar Yeri</span>
              <select
                value={mp}
                onChange={(e) => setMp(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="DEPO">Doğrudan Depo</option>
                {marketplaces.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Hedef</span>
              <select
                value={dest}
                onChange={(e) => setDest(e.target.value as 'FBA' | 'DEPO')}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="DEPO">DEPO</option>
                <option value="FBA">FBA</option>
              </select>
            </label>
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
              Devam — raf tara
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ManualBoxProps {
  initial: Pending | null;
  marketplaces: Marketplace[];
  onConfirm: (updated: Pending) => void;
  onCancel: () => void;
}

function ManualBoxModal({ initial, marketplaces, onConfirm, onCancel }: ManualBoxProps) {
  const initialManual = initial?.manual ?? { iwasku: '', productName: null, fnsku: null };
  const [iwasku, setIwasku] = useState(initialManual.iwasku);
  const [productName] = useState(initialManual.productName);
  const [fnsku] = useState(initialManual.fnsku);
  const [qty, setQty] = useState(String(initial?.qty ?? 1));
  const [mp, setMp] = useState(initial?.marketplaceCode ?? '');
  const [dest, setDest] = useState<'FBA' | 'DEPO'>(initial?.destination ?? 'DEPO');
  const [boxNumber, setBoxNumber] = useState(initial?.boxNumber ?? '');

  const canSubmit = iwasku.trim() && parseInt(qty, 10) > 0 && (mp || true);

  const submit = () => {
    if (!canSubmit) return;
    const n = parseInt(qty, 10);
    onConfirm({
      manual: { iwasku: iwasku.trim(), productName, fnsku },
      qty: Number.isFinite(n) && n > 0 ? n : 1,
      marketplaceCode: mp,
      destination: dest,
      boxNumber: boxNumber.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl md:rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-amber-600" />
            <div className="text-[11px] uppercase tracking-wide text-amber-700">Manuel giriş</div>
          </div>
          {productName && (
            <div className="text-sm font-semibold text-gray-900 mt-1">{productName}</div>
          )}
          {fnsku && (
            <div className="text-[11px] text-gray-500 mt-0.5">FNSKU: {fnsku}</div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="p-4 space-y-3"
        >
          <label className="block">
            <span className="text-xs text-gray-500">IWASKU</span>
            <input
              type="text"
              value={iwasku}
              onChange={(e) => setIwasku(e.target.value.trim())}
              placeholder="örn. IA00500MRVE9"
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
              autoFocus={!initialManual.iwasku}
            />
          </label>

          <label className="block">
            <span className="text-xs text-gray-500">Adet</span>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="mt-1 w-full text-xl font-bold text-center px-3 py-2 border-2 border-blue-500 rounded-lg"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-gray-500">Pazar Yeri</span>
              <select
                value={mp}
                onChange={(e) => setMp(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">— seçin —</option>
                <option value="DEPO">Doğrudan Depo</option>
                {marketplaces.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Hedef</span>
              <select
                value={dest}
                onChange={(e) => setDest(e.target.value as 'FBA' | 'DEPO')}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="DEPO">DEPO</option>
                <option value="FBA">FBA</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-gray-500">Koli No (opsiyonel)</span>
            <input
              type="text"
              value={boxNumber}
              onChange={(e) => setBoxNumber(e.target.value.trim())}
              placeholder="boş bırakılırsa otomatik"
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
            />
          </label>

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
              disabled={!iwasku.trim()}
              className="flex-[2] py-3 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300"
            >
              <span className="flex items-center justify-center gap-2">
                <MapPin className="w-4 h-4" />
                Devam — raf tara
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
