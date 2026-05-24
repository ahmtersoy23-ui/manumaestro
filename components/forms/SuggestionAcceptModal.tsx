'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { notify } from '@/lib/ui/notify';

interface MarketplaceMini { id: string; name: string; code: string; region: string; }
interface Suggestion {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  productionMonth: string;
  suggestedQty: number;
  formulaVersion: string;
  reasoning: string | null;
  marketplace: MarketplaceMini;
}

interface Props {
  suggestion: Suggestion;
  onClose: () => void;
  onSuccess: () => void;
}

export function SuggestionAcceptModal({ suggestion, onClose, onSuccess }: Props) {
  const [quantity, setQuantity] = useState<string>(String(suggestion.suggestedQty));
  const [priority, setPriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      notify.error('Geçerli bir miktar girin');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/production-suggestions/${suggestion.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty, priority, notes: notes || null }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? data.error ?? 'Hata');
      notify.success(`Talep oluşturuldu: ${suggestion.iwasku} — ${qty} adet`);
      onSuccess();
    } catch (err) {
      notify.error('Kabul edilemedi', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">Öneri Kabul Et</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-slate-50 rounded p-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">IWASKU:</span><span className="font-mono">{suggestion.iwasku}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Ürün:</span><span className="font-medium">{suggestion.productName}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Marketplace:</span><span className="font-mono">{suggestion.marketplace.code}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Ay:</span><span>{suggestion.productionMonth}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Model:</span><span className="font-mono">{suggestion.formulaVersion}</span></div>
            {suggestion.reasoning && (
              <div className="mt-2 text-xs text-slate-600 italic">&ldquo;{suggestion.reasoning}&rdquo;</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Miktar <span className="text-slate-400 text-xs">(önerilen: {suggestion.suggestedQty})</span>
            </label>
            <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="1"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-purple-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Öncelik</label>
            <div className="flex gap-2">
              {(['HIGH', 'MEDIUM', 'LOW'] as const).map(p => (
                <button key={p} onClick={() => setPriority(p)}
                  className={`flex-1 py-1.5 rounded text-sm font-medium ${
                    priority === p
                      ? p === 'HIGH' ? 'bg-rose-600 text-white'
                      : p === 'MEDIUM' ? 'bg-amber-500 text-white'
                      : 'bg-slate-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {p === 'HIGH' ? 'Yüksek' : p === 'MEDIUM' ? 'Orta' : 'Düşük'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Not (opsiyonel)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-purple-500" />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-200 rounded">İptal</button>
          <button onClick={submit} disabled={submitting}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
            <Check className="w-4 h-4" /> {submitting ? 'Kaydediliyor…' : 'Kabul Et ve Talep Yarat'}
          </button>
        </div>
      </div>
    </div>
  );
}
