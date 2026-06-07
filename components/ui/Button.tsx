/**
 * Button — ortak buton primitive'i.
 *
 * Önceden 89 dosyada 425 elle yazılmış <button> vardı; aksiyon rengi
 * mavi/mor/emerald arası kararsızdı. Marka aksiyon rengi: blue-600.
 *
 * Kullanım:
 *   <Button onClick={...}>Kaydet</Button>                  // primary (mavi)
 *   <Button variant="secondary">Vazgeç</Button>
 *   <Button variant="danger" loading={saving}>Sil</Button>
 *   <Button variant="ghost" size="sm" icon={<Plus .../>}>Ekle</Button>
 */
'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'warning' | 'success' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500 disabled:bg-blue-300',
  secondary:
    'bg-gray-100 text-gray-700 hover:bg-gray-200 focus-visible:ring-gray-400 disabled:text-gray-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 disabled:bg-red-300',
  // Dikkat gerektiren ama yıkıcı olmayan aksiyonlar (koli aç, raf boşalt, miktar düzelt)
  warning: 'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500 disabled:bg-amber-300',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 disabled:bg-emerald-300',
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-400',
};

const SIZE: Record<Size, string> = {
  // sm = yaygın modal footer butonu (px-3 py-1.5 text-sm) ile birebir
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Metnin solunda gösterilecek ikon (lucide vb.) */
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});
