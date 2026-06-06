'use client';

/**
 * Veeqo Etiket Al modalı — Sipariş board "Etiket Bekliyor" akışı.
 *
 * 1) Açılınca /api/siparis/veeqo-rates ile oranları çeker (etiket ALMAZ).
 * 2) Operatör en ucuzu (üstte işaretli) görüp seçer.
 * 3) "Etiketi Satın Al" → /api/siparis/veeqo-label (GERÇEK PARA) → tracking + PDF kaydedilir.
 *
 * Oranlar ~15 dk geçerli (request_token); süresi geçerse "Oranları Yenile".
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, RefreshCw, Tag, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Quote {
  rate_id: string;
  service_name: string;
  service_carrier: string;
  total_charge: string;
  delivery_estimate?: string;
  options?: Record<string, string>;
}
interface RatesResp {
  remoteShipmentId: string;
  requestToken: string;
  expiresAt: string;
  quotes: Quote[];
}
interface Parcel { weight: number; length: number; width: number; height: number }

interface Props {
  orderId: string;
  orderNumber: string;
  onClose: () => void;
  onSuccess: (trackingNumber: string) => void;
}

const carrierStyle: Record<string, string> = {
  ups: 'bg-amber-50 text-amber-800 border-amber-200',
  usps: 'bg-blue-50 text-blue-800 border-blue-200',
  fedex: 'bg-purple-50 text-purple-800 border-purple-200',
  amzn_us: 'bg-orange-50 text-orange-800 border-orange-200',
};

export default function VeeqoLabelModal({ orderId, orderNumber, onClose, onSuccess }: Props) {
  const [parcel, setParcel] = useState<Parcel | null>(null); // katalogtan dolar (ilk yanıt)
  const [fromCatalog, setFromCatalog] = useState(false);
  const [rates, setRates] = useState<RatesResp | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [loadingRates, setLoadingRates] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRates = useCallback(async () => {
    setLoadingRates(true); setError(null); setRates(null); setSelected('');
    try {
      const res = await fetch('/api/siparis/veeqo-rates', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, ...(parcel ? { parcel } : {}) }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || `HTTP ${res.status}`);
      const sorted: Quote[] = [...(j.quotes ?? [])].sort((a, b) => parseFloat(a.total_charge) - parseFloat(b.total_charge));
      setRates({ remoteShipmentId: j.remoteShipmentId, requestToken: j.requestToken, expiresAt: j.expiresAt, quotes: sorted });
      if (sorted[0]) setSelected(sorted[0].rate_id); // en ucuz otomatik seçili
      // ilk yanıtta kullanılan koliyi (katalogtan) ölçü kutularına yaz
      if (j.parcel) { setParcel({ weight: j.parcel.weight, length: j.parcel.length, width: j.parcel.width, height: j.parcel.height }); setFromCatalog(!!j.parcelFromCatalog); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oran alınamadı');
    } finally {
      setLoadingRates(false);
    }
  }, [orderId, parcel]);

  useEffect(() => { fetchRates(); /* ilk açılış */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const book = async () => {
    if (!rates || !selected) return;
    setBooking(true); setError(null);
    try {
      const res = await fetch('/api/siparis/veeqo-label', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, remoteShipmentId: rates.remoteShipmentId, rateId: selected, requestToken: rates.requestToken, options: rates.quotes.find((q) => q.rate_id === selected)?.options }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        if (j.alreadyHasLabel) { onSuccess(j.trackingNumber); return; }
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onSuccess(j.trackingNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiket alınamadı');
    } finally {
      setBooking(false);
    }
  };

  const sel = rates?.quotes.find((q) => q.rate_id === selected);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
          <div className="font-bold text-gray-900 flex items-center gap-2"><Tag className="w-5 h-5 text-sky-600" /> Veeqo Etiket Al</div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="text-xs text-gray-500">Sipariş <span className="font-mono text-gray-700">{orderNumber}</span></div>

          {/* Koli ölçüsü */}
          <div className="rounded-lg border border-gray-100 p-3">
            <div className="text-[11px] text-gray-400 uppercase mb-2 flex items-center gap-1.5">
              Koli (ölçü düzeltilebilir)
              {fromCatalog && <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 normal-case">katalogtan</span>}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {([['weight', 'lb'], ['length', 'in'], ['width', 'in'], ['height', 'in']] as const).map(([k, unit]) => (
                <label key={k} className="text-xs text-gray-600">
                  <span className="capitalize">{k === 'weight' ? 'Ağırlık' : k === 'length' ? 'Boy' : k === 'width' ? 'En' : 'Yük.'}</span>
                  <div className="mt-0.5 flex items-center gap-1">
                    <input type="number" min={0} step="0.1" value={parcel?.[k] ?? ''} disabled={!parcel}
                      onChange={(e) => setParcel((p) => ({ weight: p?.weight ?? 0, length: p?.length ?? 0, width: p?.width ?? 0, height: p?.height ?? 0, [k]: Number(e.target.value) }))}
                      className="w-full text-sm px-2 py-1 rounded border border-gray-300 bg-white text-gray-800 disabled:bg-gray-50" />
                    <span className="text-[10px] text-gray-400">{unit}</span>
                  </div>
                </label>
              ))}
            </div>
            <button onClick={fetchRates} disabled={loadingRates || booking}
              className="mt-2 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingRates ? 'animate-spin' : ''}`} /> Oranları Yenile
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {loadingRates && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Oranlar çekiliyor…</div>
          )}

          {rates && !loadingRates && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-gray-400 uppercase">{rates.quotes.length} oran (ucuzdan pahalıya)</div>
              {rates.quotes.map((q, i) => (
                <label key={q.rate_id} className={`flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer ${selected === q.rate_id ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300' : 'border-gray-150 hover:bg-gray-50'}`}>
                  <input type="radio" name="rate" checked={selected === q.rate_id} onChange={() => setSelected(q.rate_id)} className="accent-sky-600" />
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${carrierStyle[q.service_carrier] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>{q.service_carrier.toUpperCase()}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{q.service_name}{i === 0 && <span className="ml-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1">en ucuz</span>}</div>
                    {q.delivery_estimate && <div className="text-[11px] text-gray-400">Tahmini teslim: {new Date(q.delivery_estimate).toLocaleDateString('tr-TR')}</div>}
                  </div>
                  <div className="text-sm font-semibold text-gray-900 shrink-0">${q.total_charge}</div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50/50">
          <div className="text-xs text-gray-500">{sel ? <>Seçili: <span className="font-medium text-gray-700">{sel.service_name}</span> · <span className="font-semibold">${sel.total_charge}</span></> : 'Oran seçin'}</div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={booking} className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50">Vazgeç</button>
            <button onClick={book} disabled={!selected || booking || loadingRates}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
              {booking ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Etiketi Satın Al
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
