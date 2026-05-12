'use client';

/**
 * Sevkiyat detay sayfasında FNSKU eksik olan kalemler için inline input.
 * "Eksik" badge'i tıklanınca input açılır, kayıt SKU master'a güncellenir.
 * shipments/[id]/page.tsx'ten ayrıldı.
 */

import { useState } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { MKT_CODE_TO_COUNTRY, type ShipmentItem } from '@/lib/shipments/types';

interface Props {
  item: ShipmentItem;
  onSaved: (itemId: string, fnsku: string) => void;
}

export function InlineFnskuInput({ item, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const fnsku = value.trim();
    if (!fnsku) {
      setEditing(false);
      return;
    }
    const countryCode = item.marketplace?.code ? MKT_CODE_TO_COUNTRY[item.marketplace.code] : null;
    if (!countryCode) {
      setError('Marketplace eşleştirilemedi');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/sku-master/fnsku', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentItemId: item.id, iwasku: item.iwasku, countryCode, fnsku }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved(item.id, data.data.fnsku ?? fnsku);
        setEditing(false);
      } else {
        setError(data.error || 'Hata');
      }
    } catch {
      setError('Bağlantı hatası');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setValue(''); setError(''); }}
        className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium hover:bg-amber-200 transition-colors cursor-pointer"
        title="FNSKU girmek için tıkla"
      >
        Eksik
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
          placeholder="FNSKU"
          disabled={saving}
          className="px-1.5 py-0.5 border border-amber-300 rounded text-xs font-mono w-28 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
        ) : (
          <>
            <button onClick={handleSave} className="text-green-600 hover:text-green-800">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}
