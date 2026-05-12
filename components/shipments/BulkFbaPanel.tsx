/**
 * BulkFbaPanel — Koli numaralarına göre FBA/Depo/Showroom toplu işaretleme.
 *
 * Sevkiyat detay sayfasında "Koliler" tab'ında açılır. Submit + state parent'ta.
 */

import { X, Loader2 } from 'lucide-react';

interface Props {
  text: string;
  saving: boolean;
  result: { updated: number; notFound?: string[] } | null;
  onTextChange: (text: string) => void;
  onSubmit: (dest: 'FBA' | 'DEPO' | 'SHOWROOM') => void;
  onClose: () => void;
}

export function BulkFbaPanel({ text, saving, result, onTextChange, onSubmit, onClose }: Props) {
  const disabled = saving || !text.trim();

  return (
    <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Toplu FBA / Depo İşaretleme</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-gray-500">Koli numaralarını alt alta, virgül veya tab ile ayırarak girin:</p>
      <textarea
        value={text}
        onChange={e => onTextChange(e.target.value)}
        placeholder={"69-0001\n69-0002\n69-0003"}
        rows={6}
        className="w-full px-3 py-2 border rounded-lg text-sm font-mono resize-y"
      />
      <div className="flex items-center gap-3">
        <button onClick={() => onSubmit('FBA')} disabled={disabled}
          className="px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} FBA Olarak İşaretle
        </button>
        <button onClick={() => onSubmit('DEPO')} disabled={disabled}
          className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
          Depo Olarak İşaretle
        </button>
        <button onClick={() => onSubmit('SHOWROOM')} disabled={disabled}
          className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
          Fairfield Olarak İşaretle
        </button>
      </div>
      {result && (
        <div className="text-sm">
          <p className="text-green-700">{result.updated} koli güncellendi.</p>
          {result.notFound && result.notFound.length > 0 && (
            <p className="text-red-600 mt-1">Bulunamayan: {result.notFound.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
