/**
 * Tek kaynak navigasyon yapılandırması (UI/IA reorg Faz 1).
 * Üst-nav 4 ana grup: Üretim / Stok / Sevkiyat / Sipariş. Header (desktop+mobil)
 * ve hub landing sayfaları bunu okur — link tek yerde değişir.
 *
 * - Çok-alanlı gruplar (Üretim, Stok) `children` taşır → hub landing sayfası kartları.
 * - Tek-alanlı gruplar (Sevkiyat, Sipariş) doğrudan `href`'e gider (hub yok).
 * - Admin öğeleri (İzinler/Geçmiş) üst-navda değil, kullanıcı menüsünde (ADMIN_LINKS).
 * - Etiket bilinçli olarak HEM Üretim HEM Stok altında (çift bağ, tek route).
 *
 * Rota TAŞINMADI (A2 sonra): child href'ler mevcut sayfalara işaret eder.
 */

import type { LucideIcon } from 'lucide-react';
import { Factory, Boxes, Ship, ShoppingCart, Home, CalendarRange, Printer, Warehouse, Shield, FileText } from 'lucide-react';

export interface NavLink {
  label: string;
  href: string;
  icon: LucideIcon;
  desc?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  href: string; // grup girişi: hub sayfası (çok-alanlı) veya doğrudan route (tek-alanlı)
  requireStock?: boolean; // canViewStock gerektirir
  children?: NavLink[]; // hub kartları (yalnız çok-alanlı gruplarda)
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'uretim',
    label: 'Üretim',
    icon: Factory,
    href: '/dashboard/uretim',
    children: [
      { label: 'Aylık Talep', href: '/dashboard2', icon: Home, desc: 'Aylık üretim talebi ve kategori kırılımı' },
      { label: 'Sezon', href: '/dashboard/seasonal', icon: CalendarRange, desc: 'Sezonsal stok havuzu planlaması' },
      { label: 'Etiket', href: '/dashboard/labels', icon: Printer, desc: 'Ürün / koli QR etiketleri' },
    ],
  },
  {
    key: 'stok',
    label: 'Stok',
    icon: Boxes,
    href: '/dashboard/stok',
    requireStock: true,
    children: [
      { label: 'Stok Haritası', href: '/dashboard/stok-haritasi', icon: Boxes, desc: 'Tüm depolar — iwasku bazlı stok haritası' },
      { label: 'Depolar', href: '/dashboard/depolar', icon: Warehouse, desc: 'WMS — raf, sayım, çıkış, hareketler' },
      { label: 'Etiket', href: '/dashboard/labels', icon: Printer, desc: 'Ürün / koli QR etiketleri' },
    ],
  },
  { key: 'sevkiyat', label: 'Sevkiyat', icon: Ship, href: '/dashboard/shipments' },
  { key: 'siparis', label: 'Sipariş', icon: ShoppingCart, href: '/dashboard/siparis' },
];

export interface AdminLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Üst-navda değil — kullanıcı menüsünde (yalnız admin). */
export const ADMIN_LINKS: AdminLink[] = [
  { label: 'İzinler', href: '/dashboard/admin/permissions', icon: Shield },
  { label: 'Geçmiş', href: '/dashboard/logs', icon: FileText },
];

/** Ana sayfa (logo) hedefi — 4-kart özet dashboard (A1.5). */
export const HOME_HREF = '/dashboard/overview';

export function getNavGroup(key: string): NavGroup | undefined {
  return NAV_GROUPS.find((g) => g.key === key);
}
