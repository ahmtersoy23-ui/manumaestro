/**
 * EditShipmentForm — sevkiyat ismi/plannedDate/etaDate/notes düzenleme paneli.
 *
 * İsim (gemi) alanı yalnızca admin'lere açık (canEditName); diğer alanlar
 * formu açabilen herkese. Save + Cancel butonu. Network parent'ta.
 */

import { Button } from '@/components/ui/Button';

export interface EditFormState {
  name: string;
  plannedDate: string;
  etaDate: string;
  notes: string;
}

interface Props {
  form: EditFormState;
  saving: boolean;
  /** İsim (gemi) alanı düzenlenebilir mi — admin'e açık */
  canEditName?: boolean;
  onChange: (updater: (f: EditFormState) => EditFormState) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function EditShipmentForm({ form, saving, canEditName = false, onChange, onSave, onCancel }: Props) {
  return (
    <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-gray-900">Sevkiyat Bilgilerini Düzenle</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">İsim (Gemi)</label>
          <input type="text" value={form.name} disabled={!canEditName}
            onChange={e => onChange(f => ({ ...f, name: e.target.value }))}
            className={`w-full px-3 py-2 border rounded-lg text-sm ${canEditName ? '' : 'bg-gray-50 text-gray-500'}`} />
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
        <Button onClick={onSave} loading={saving}>Kaydet</Button>
        <Button variant="secondary" onClick={onCancel}>İptal</Button>
      </div>
    </div>
  );
}
