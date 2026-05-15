/**
 * DateMultiFilter — sevkiyat item listelerinde eklenme tarihine göre
 * çoklu seçimli filtre. Dropdown'a tıklayınca distinct tarihler (YYYY-MM-DD)
 * checkbox listesi olarak alt alta gösterilir.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  dates: string[];          // distinct YYYY-MM-DD, desc sıralı önerilir
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function DateMultiFilter({ dates, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (d: string) => {
    const next = new Set(selected);
    if (next.has(d)) next.delete(d); else next.add(d);
    onChange(next);
  };

  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-2 border rounded-lg text-sm bg-white text-gray-700 flex items-center gap-2 hover:bg-gray-50"
      >
        {selected.size > 0 ? `${selected.size} tarih` : 'Tüm Tarihler'}
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 bg-white border rounded-lg shadow-lg z-20 min-w-[160px] max-h-64 overflow-auto">
          {dates.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">Tarih yok</div>
          ) : (
            <>
              {selected.size > 0 && (
                <button
                  onClick={() => onChange(new Set())}
                  className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-gray-50 border-b"
                >
                  Temizle
                </button>
              )}
              {dates.map(d => (
                <label key={d} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(d)}
                    onChange={() => toggle(d)}
                  />
                  <span>{fmt(d)}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
