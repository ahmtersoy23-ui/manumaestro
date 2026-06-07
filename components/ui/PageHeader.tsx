/**
 * PageHeader — sayfa başlığı paterni (ikon + başlık + alt başlık + aksiyonlar)
 * 10+ sayfada elle tekrar ediyordu. Tek primitive.
 *
 * <PageHeader
 *   icon={<Package className="w-6 h-6" />}
 *   title="Sevkiyatlar"
 *   subtitle="Konteyner ve kalem yönetimi"
 *   actions={<Button>Yeni</Button>}
 * />
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Genelde lucide ikon; mavi yuvarlak kutu içinde gösterilir */
  icon?: ReactNode;
  /** Sağa yaslanan aksiyon butonları */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
