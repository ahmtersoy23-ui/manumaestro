'use client';

/**
 * Ek koli ekleme formu (sevkiyat detay sayfası).
 * SHIPMENT'ta üretim dışı koli (örn. satın alınmış FBA paketleri) eklemek için.
 * shipments/[id]/page.tsx'ten ayrıldı.
 */

import { useState } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import type { BoxFormData } from '@/lib/shipments/types';

interface Props {
  onSubmit: (form: BoxFormData) => Promise<void>;
  onCancel: () => void;
}

export function ExtraBoxForm({ onSubmit, onCancel }: Props) {
  const [f, setF] = useState({
    iwasku: '', fnsku: '', productName: '', productCategory: '', marketplaceCode: '',
    quantity: '1', count: '1', width: '', height: '', depth: '', weight: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const count = parseInt(f.count) || 1;
      for (let i = 0; i < count; i++) {
        await onSubmit({
          iwasku: f.iwasku || null,
          fnsku: f.fnsku || null,
          productName: f.productName || null,
          productCategory: f.productCategory || null,
          marketplaceCode: f.marketplaceCode || null,
          quantity: parseInt(f.quantity) || 1,
          width: f.width ? parseFloat(f.width) : null,
          height: f.height ? parseFloat(f.height) : null,
          depth: f.depth ? parseFloat(f.depth) : null,
          weight: f.weight ? parseFloat(f.weight) : null,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-blue-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Ek Koli (Üretim Dışı)</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="block text-xs text-gray-500 mb-0.5">IWASKU</label>
          <input type="text" value={f.iwasku} onChange={e => setF(p => ({ ...p, iwasku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-40" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">FNSKU</label>
          <input type="text" value={f.fnsku} onChange={e => setF(p => ({ ...p, fnsku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-32 font-mono" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ürün Adı</label>
          <input type="text" value={f.productName} onChange={e => setF(p => ({ ...p, productName: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-48" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Kategori</label>
          <input type="text" value={f.productCategory} onChange={e => setF(p => ({ ...p, productCategory: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-36" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Pazar Yeri</label>
          <input type="text" value={f.marketplaceCode} onChange={e => setF(p => ({ ...p, marketplaceCode: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-24" /></div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="block text-xs text-gray-500 mb-0.5">Adet/Koli</label>
          <input type="number" value={f.quantity} onChange={e => setF(p => ({ ...p, quantity: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-16" required /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">En</label>
          <input type="number" step="0.1" value={f.width} onChange={e => setF(p => ({ ...p, width: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Boy</label>
          <input type="number" step="0.1" value={f.depth} onChange={e => setF(p => ({ ...p, depth: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Yükseklik</label>
          <input type="number" step="0.1" value={f.height} onChange={e => setF(p => ({ ...p, height: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ağırlık</label>
          <input type="number" step="0.01" value={f.weight} onChange={e => setF(p => ({ ...p, weight: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Çoğalt</label>
          <input type="number" min="1" max="200" value={f.count} onChange={e => setF(p => ({ ...p, count: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-16" /></div>
        <button type="submit" disabled={saving} className="self-end px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {parseInt(f.count) > 1 ? `${f.count} Koli Ekle` : 'Koli Ekle'}
        </button>
      </div>
    </form>
  );
}
