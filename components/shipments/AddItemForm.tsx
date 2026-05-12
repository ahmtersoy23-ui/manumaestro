/**
 * AddItemForm — sevkiyata IWASKU + miktar + pazaryeri ile ürün ekleme formu.
 *
 * Pending tab'inde "Ürün Ekle" butonuyla açılır. Submit parent'ta (handleAddItem).
 */

import { Loader2 } from 'lucide-react';

export interface AddItemFormState {
  iwasku: string;
  quantity: string;
  marketplaceId: string;
}

interface Marketplace {
  id: string;
  name: string;
  code: string;
}

interface Props {
  form: AddItemFormState;
  marketplaces: Marketplace[];
  adding: boolean;
  onChange: (updater: (f: AddItemFormState) => AddItemFormState) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function AddItemForm({ form, marketplaces, adding, onChange, onSubmit }: Props) {
  return (
    <form onSubmit={onSubmit} className="bg-white border border-blue-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">IWASKU</label>
        <input type="text" required value={form.iwasku}
          onChange={e => onChange(f => ({ ...f, iwasku: e.target.value }))}
          className="px-3 py-2 border rounded-lg text-sm w-48" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Miktar</label>
        <input type="number" required value={form.quantity}
          onChange={e => onChange(f => ({ ...f, quantity: e.target.value }))}
          className="px-3 py-2 border rounded-lg text-sm w-24" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Pazaryeri</label>
        <select required value={form.marketplaceId}
          onChange={e => onChange(f => ({ ...f, marketplaceId: e.target.value }))}
          className="px-3 py-2 border rounded-lg text-sm w-48">
          <option value="">Seçiniz</option>
          {marketplaces.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
        </select>
      </div>
      <button type="submit" disabled={adding}
        className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
        {adding && <Loader2 className="w-4 h-4 animate-spin" />} Ekle
      </button>
    </form>
  );
}
