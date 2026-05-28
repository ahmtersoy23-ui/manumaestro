/**
 * Yeni Talep Modal (V2 sayfası için)
 * Bölge'ye göre destinasyon seçimi + ManualEntryForm reuse.
 * Submit sonrası entryType=MANUAL ProductionRequest oluşur.
 */

'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { ManualEntryForm } from '@/components/forms/ManualEntryForm';
import type { Region } from '@/lib/marketplaceRegions';
import { REGION_LABELS } from '@/lib/marketplaceRegions';

interface Marketplace {
  id: string;
  code: string;
  name: string;
}

interface Props {
  defaultRegion: Region;
  marketplaces: Marketplace[]; // Bölgenin destinasyon'ları
  onClose: () => void;
  onSuccess: () => void;
}

export function NewRequestModal({ defaultRegion, marketplaces, onClose, onSuccess }: Props) {
  const [selectedMpId, setSelectedMpId] = useState<string>(marketplaces[0]?.id ?? '');
  const selected = marketplaces.find(m => m.id === selectedMpId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold">Yeni Üretim Talebi</h2>
            <p className="text-xs text-slate-500">
              {REGION_LABELS[defaultRegion]} bölgesi · MANUEL kayıt
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Destinasyon seçim */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Destinasyon (Pazar Yeri)</label>
            <select
              value={selectedMpId}
              onChange={e => setSelectedMpId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-purple-500"
            >
              {marketplaces.length === 0 && <option value="">Bölge marketplace tanımlı değil</option>}
              {marketplaces.map(m => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
              <p className="text-xs text-slate-500 mb-2">
                <strong className="text-slate-700">{selected.name}</strong> ({selected.code}) için talep
              </p>
              <ManualEntryForm
                marketplaceId={selected.id}
                marketplaceName={selected.name}
                onSuccess={onSuccess}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
