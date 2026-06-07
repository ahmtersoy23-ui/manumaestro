/**
 * Rozet (badge) stilleri — tek kaynak.
 *
 * Önceden PRIORITY_STYLE / STATUS_COLORS aynı tanım 3+ dosyada kopyalanıyordu
 * (RequestsTable, ProductMarketplaceModal, manufacturer/[category]).
 * Artık hepsi buradan okur. Yeni rozet rengi gerekiyorsa BURAYA ekle.
 *
 * Not: class string'leri literal — Tailwind v4 oxide tarayıcısı görür,
 * dinamik interpolasyon yok (safelist gerekmez).
 */

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type RequestStatus =
  | 'REQUESTED'
  | 'IN_PRODUCTION'
  | 'PARTIALLY_PRODUCED'
  | 'COMPLETED'
  | 'CANCELLED';

/** Üretim talebi önceliği — kırmızı/amber/mavi */
export const PRIORITY_STYLE: Record<Priority, string> = {
  HIGH: 'bg-red-100 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
  LOW: 'bg-blue-100 text-blue-700 border-blue-200',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
};

/** Üretim talebi durumu */
export const STATUS_STYLE: Record<RequestStatus, string> = {
  REQUESTED: 'bg-blue-100 text-blue-700 border-blue-200',
  IN_PRODUCTION: 'bg-orange-100 text-orange-700 border-orange-200',
  PARTIALLY_PRODUCED: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  COMPLETED: 'bg-green-100 text-green-700 border-green-200',
  CANCELLED: 'bg-gray-100 text-gray-700 border-gray-200',
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  REQUESTED: 'Talep Edildi',
  IN_PRODUCTION: 'Üretimde',
  PARTIALLY_PRODUCED: 'Kısmen Üretildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

/** Bilinmeyen anahtarlar için güvenli fallback */
export const FALLBACK_BADGE = 'bg-gray-100 text-gray-700 border-gray-200';
