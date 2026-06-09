'use client';

/**
 * Serbest kargo fiyat sorgu modalı (siparişe bağlı DEĞİL).
 * Operatör ship-from depo + varış ZIP + koli ölçüsü girer → Veeqo oran listesi.
 * Eyalet ZIP'ten otomatik türetilir (Amazon Shipping rate validator'ı eyaleti zorunlu
 * tutar + ZIP ile uyumlu olmalı); isim/sokak/şehir gerekmez (backend generic doldurur).
 * Etiket ALMAZ, para çekmez (POST /api/siparis/rate-quote → getRates standalone).
 */

import { useState } from 'react';
import { X, Calculator, Loader2, Package } from 'lucide-react';

interface Quote {
  rate_id: string;
  service_name: string;
  service_carrier: string;
  total_charge: string;
  delivery_estimate?: string;
}

const WAREHOUSES = [
  { code: 'NJ', label: 'Somerset (NJ)' },
  { code: 'SHOWROOM', label: 'Fairfield (Showroom)' },
] as const;

// US ZIP ilk-3-hane → eyalet (USPS SCF). Edge'lerde elle düzeltilebilir.
const ZIP3: Array<[number, number, string]> = [
  [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'],
  [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'],
  [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'],
  [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'],
  [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'],
  [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'],
  [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'],
  [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'], [733, 733, 'TX'],
  [734, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'],
  [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'],
  [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];
function zipToState(zip: string): string {
  const digits = zip.replace(/\D/g, '');
  if (digits.length < 3) return '';
  const p = Number(digits.slice(0, 3));
  return ZIP3.find(([lo, hi]) => p >= lo && p <= hi)?.[2] ?? '';
}

const field = 'w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none';
const lbl = 'block text-[11px] font-medium text-gray-500 mb-0.5';

export default function RateQuoteModal({ onClose }: { onClose: () => void }) {
  const [warehouse, setWarehouse] = useState<'NJ' | 'SHOWROOM'>('NJ');
  const [postcode, setPostcode] = useState('');
  const [state, setState] = useState('');           // ZIP'ten oto, elle düzeltilebilir
  const [stateAuto, setStateAuto] = useState(true);  // kullanıcı elle değiştirdiyse oto-doldurmayı bırak
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [destState, setDestState] = useState<string | null>(null);

  function onZip(v: string) {
    setPostcode(v);
    if (stateAuto) { const s = zipToState(v); if (s) setState(s); }
  }

  const num = (s: string) => Number(String(s).replace(',', '.'));
  const ready = postcode.trim().length >= 3 && state.trim().length === 2 &&
    num(weight) > 0 && num(length) > 0 && num(width) > 0 && num(height) > 0;

  async function submit() {
    if (!ready || loading) return;
    setLoading(true); setError(null); setQuotes(null); setDestState(null);
    try {
      const res = await fetch('/api/siparis/rate-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse, postcode: postcode.trim(), state: state.trim().toUpperCase(),
          parcel: { weight: num(weight), weight_unit: 'lb', length: num(length), width: num(width), height: num(height), dimension_unit: 'in' },
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || `HTTP ${res.status}`);
      setQuotes(j.quotes ?? []);
      setDestState(j.destState ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sorgu hatası');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mt-10 mb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-900">Kargo Fiyat Sorgu</h2>
            <span className="text-[11px] text-gray-400">etiket almaz · para çekmez</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Ship-from */}
          <div>
            <span className={lbl}>Çıkış Deposu (ship-from)</span>
            <div className="flex gap-2">
              {WAREHOUSES.map((w) => (
                <button key={w.code} onClick={() => setWarehouse(w.code)}
                  className={`flex-1 text-sm px-3 py-1.5 rounded-lg border ${warehouse === w.code ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* Varış: ZIP + eyalet (oto) */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className={lbl}>Varış ZIP</label>
              <input className={field} value={postcode} onChange={(e) => onZip(e.target.value)} placeholder="08850" inputMode="numeric" />
            </div>
            <div>
              <label className={lbl}>Eyalet <span className="text-gray-400">(ZIP&apos;ten oto)</span></label>
              <input className={field + ' uppercase'} value={state} maxLength={2}
                onChange={(e) => { setState(e.target.value.toUpperCase()); setStateAuto(false); }} placeholder="NJ" />
            </div>
          </div>

          {/* Koli */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1.5"><Package className="w-3.5 h-3.5" /> Koli Ölçüsü</div>
            <div className="grid grid-cols-4 gap-2">
              <div><label className={lbl}>Ağırlık (lb)</label><input type="number" min="0" step="0.1" className={field} value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
              <div><label className={lbl}>Boy (in)</label><input type="number" min="0" step="0.1" className={field} value={length} onChange={(e) => setLength(e.target.value)} /></div>
              <div><label className={lbl}>En (in)</label><input type="number" min="0" step="0.1" className={field} value={width} onChange={(e) => setWidth(e.target.value)} /></div>
              <div><label className={lbl}>Yükseklik (in)</label><input type="number" min="0" step="0.1" className={field} value={height} onChange={(e) => setHeight(e.target.value)} /></div>
            </div>
          </div>

          <button onClick={submit} disabled={!ready || loading}
            className="w-full inline-flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            {loading ? 'Sorgulanıyor…' : 'Fiyatları Sorgula'}
          </button>

          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {quotes && (
            quotes.length === 0 ? (
              <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">Bu ölçü/ZIP için kargo seçeneği bulunamadı.</div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
                  <span>{quotes.length} seçenek · ucuzdan pahalıya</span>
                  {destState && <span>varış: {destState}</span>}
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                    <th className="px-3 py-1.5 font-medium">Servis</th>
                    <th className="px-3 py-1.5 font-medium">Taşıyıcı</th>
                    <th className="px-3 py-1.5 font-medium">Teslim</th>
                    <th className="px-3 py-1.5 font-medium text-right">Ücret</th>
                  </tr></thead>
                  <tbody>
                    {quotes.map((q, i) => (
                      <tr key={q.rate_id} className={`border-b border-gray-50 last:border-0 ${i === 0 ? 'bg-emerald-50/60' : ''}`}>
                        <td className="px-3 py-2 text-gray-800">{q.service_name}{i === 0 && <span className="ml-1.5 text-[10px] font-semibold text-emerald-700">en ucuz</span>}</td>
                        <td className="px-3 py-2 text-gray-500 uppercase text-xs">{q.service_carrier}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{q.delivery_estimate ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">${q.total_charge}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
