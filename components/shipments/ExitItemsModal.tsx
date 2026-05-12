/**
 * ExitItemsModal — sevkiyat gönderildikten sonra depo çıkışı kayıt modalı.
 *
 * Items + week (Pazartesi) input + sayfalı listele + Onayla butonu.
 * Network çağrısı parent'ta (handleConfirmExit).
 */

import { X, Loader2, Check } from 'lucide-react';

export interface ExitItem {
  iwasku: string;
  name: string;
  quantity: number;
}

interface Props {
  items: ExitItem[];
  week: string;
  saving: boolean;
  page: number;
  onWeekChange: (week: string) => void;
  onPageChange: (page: number) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const PAGE_SIZE = 10;

export function ExitItemsModal({
  items, week, saving, page, onWeekChange, onPageChange, onClose, onConfirm,
}: Props) {
  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const visible = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">Depo Çıkışı</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hafta (Pazartesi)</label>
            <input type="date" value={week} onChange={e => onWeekChange(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm w-44" />
          </div>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">IWASKU</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">Ürün Adı</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-600">Adet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(item => (
                  <tr key={item.iwasku}>
                    <td className="px-4 py-2 font-mono text-sm">{item.iwasku}</td>
                    <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[200px]">{item.name}</td>
                    <td className="px-4 py-2 text-sm font-semibold text-right">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <button onClick={() => onPageChange(Math.max(0, page - 1))} disabled={page === 0}
                className="px-3 py-1 text-xs border rounded disabled:opacity-30">Önceki</button>
              <span className="text-xs text-gray-500">{page + 1} / {totalPages}</span>
              <button onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1 text-xs border rounded disabled:opacity-30">Sonraki</button>
            </div>
          )}
          <p className="text-sm text-gray-500">
            Toplam: <span className="font-semibold text-gray-900">{totalQty}</span> adet
            ({items.length} ürün)
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Atla
          </button>
          <button onClick={onConfirm} disabled={saving || !week}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Onayla
          </button>
        </div>
      </div>
    </div>
  );
}
