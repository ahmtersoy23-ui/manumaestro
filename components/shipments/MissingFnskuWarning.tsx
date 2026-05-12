/**
 * MissingFnskuWarning — FNSKU eksik Amazon SKU'larını sıralayan amber uyarı.
 *
 * Parent tarafından sadece etkilenen item listesi gönderilir; boş ise null.
 */

import { AlertCircle } from 'lucide-react';

interface Item {
  id: string;
  iwasku: string;
}

interface Props {
  items: Item[];
}

export function MissingFnskuWarning({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">{items.length} üründe FNSKU eksik</p>
          <p className="text-xs text-amber-600 mt-1">Tabloda &quot;Eksik&quot; yazan hücreye tıklayarak FNSKU girebilirsiniz.</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {items.map(i => (
              <span key={i.id} className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs font-mono">{i.iwasku}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
