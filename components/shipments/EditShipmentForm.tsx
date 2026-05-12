/**
 * EditShipmentForm — sevkiyat plannedDate/etaDate/notes düzenleme paneli.
 *
 * İsim alanı disabled (immutable). Save + Cancel butonu. Network parent'ta.
 */

import { Loader2 } from 'lucide-react';

export interface EditFormState {
  name: string;
  plannedDate: string;
  etaDate: string;
  notes: string;
}

interface Props {
  form: EditFormState;
  saving: boolean;
  onChange: (updater: (f: EditFormState) => EditFormState) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function EditShipmentForm({ form, saving, onChange, onSave, onCancel }: Props) {
  return (
    <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-gray-900">Sevkiyat Bilgilerini Düzenle</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">İsim</label>
          <input type="text" value={form.name} disabled
            className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Planlanan Tarih</label>
          <input type="date" value={form.plannedDate}
            onChange={e => onChange(f => ({ ...f, plannedDate: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tahmini Varış (ETA)</label>
          <input type="date" value={form.etaDate}
            onChange={e => onChange(f => ({ ...f, etaDate: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Not</label>
          <input type="text" value={form.notes}
            onChange={e => onChange(f => ({ ...f, notes: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Sevkiyat notu..." />
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onSave} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Kaydet
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">İptal</button>
      </div>
    </div>
  );
}
