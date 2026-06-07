/**
 * Card — `bg-white rounded-xl border border-gray-200` paterni 30+ yerde
 * elle tekrar ediyordu. Tek primitive.
 *
 * <Card>...</Card>
 * <Card padded>...</Card>          // p-4 ekler
 * <Card as="section" className="...">...</Card>
 */
import { type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface CardProps {
  children: ReactNode;
  /** İç boşluk ekle (p-4) — varsayılan kapalı, çünkü tablolar kenara dayanır */
  padded?: boolean;
  className?: string;
  as?: ElementType;
}

export function Card({ children, padded = false, className, as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={cn(
        'bg-white rounded-xl border border-gray-200 shadow-sm',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
