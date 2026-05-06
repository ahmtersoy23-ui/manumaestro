/**
 * Basit action dropdown — buton tıklayınca açılan menü.
 * Click-outside ile kapanır, Escape ile kapanır, item seçince kapanır.
 */

'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface DropdownItem {
  key: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}

interface Props {
  label: string;
  icon?: ReactNode;
  items: DropdownItem[];
  variant?: 'primary' | 'secondary';
}

export function ActionDropdown({ label, icon, items, variant = 'secondary' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const buttonCls =
    variant === 'primary'
      ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700'
      : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonCls}
      >
        {icon}
        {label}
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute z-20 mt-1 left-0 min-w-[220px] bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onClick();
              }}
              title={item.disabled ? item.disabledReason : undefined}
              className={`w-full text-left px-3 py-2 text-sm flex items-start gap-2 border-b border-gray-100 last:border-b-0 ${
                item.disabled
                  ? 'text-gray-400 cursor-not-allowed bg-gray-50'
                  : 'text-gray-700 hover:bg-blue-50'
              }`}
            >
              {item.icon && <span className="mt-0.5 flex-shrink-0">{item.icon}</span>}
              <span className="flex-1">
                <span className="block font-medium">{item.label}</span>
                {item.description && (
                  <span className="block text-[11px] text-gray-500 mt-0.5">{item.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
