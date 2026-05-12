'use client';

/**
 * Sevkiyat detay: deniz akışında kalem bazlı koli girişi paneli.
 * Mevcut kolileri listeler + yeni koli ekleme formu.
 * shipments/[id]/page.tsx'ten ayrıldı.
 */

import { useState } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import type { BoxFormData, ShipmentBox, ShipmentItem } from '@/lib/shipments/types';

interface Props {
  item: ShipmentItem;
  existingBoxes: ShipmentBox[];
  onCreateBox: (form: BoxFormData) => Promise<ShipmentBox | null>;
  onDeleteBox: (boxId: string) => void;
}

export function BoxEntryPanel({ item, existingBoxes, onCreateBox, onDeleteBox }: Props) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [depth, setDepth] = useState('');
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onCreateBox({
        iwasku: item.iwasku,
        fnsku: item.fnsku,
        productName: item.productName,
        productCategory: item.productCategory,
        marketplaceCode: item.marketplace?.code ?? null,
        quantity: parseInt(quantity) || 1,
        width: width ? parseFloat(width) : null,
        height: height ? parseFloat(height) : null,
        depth: depth ? parseFloat(depth) : null,
        weight: weight ? parseFloat(weight) : null,
      });
      setQuantity(String(item.quantity));
      setWidth('');
      setHeight('');
      setDepth('');
      setWeight('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {existingBoxes.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-1">Mevcut koliler:</p>
          {existingBoxes.map(box => (
            <div key={box.id} className="flex items-center gap-3 text-xs bg-white rounded px-3 py-1.5 border">
              <span className="font-mono font-semibold text-gray-900">{box.boxNumber}</span>
              <span className="text-gray-500">{box.quantity} adet</span>
              {box.width && <span className="text-gray-500">{box.width}x{box.depth}x{box.height}cm</span>}
              {box.weight && <span className="text-gray-500">{box.weight}kg</span>}
              <button onClick={() => onDeleteBox(box.id)} className="ml-auto text-red-400 hover:text-red-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end">
        <div><label className="block text-xs text-gray-500 mb-0.5">Adet</label>
          <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-16" required /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">En</label>
          <input type="number" step="0.1" value={width} onChange={e => setWidth(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Boy</label>
          <input type="number" step="0.1" value={depth} onChange={e => setDepth(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Yükseklik</label>
          <input type="number" step="0.1" value={height} onChange={e => setHeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ağırlık</label>
          <input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Koli Ekle
        </button>
      </form>
    </div>
  );
}
