/**
 * /dashboard kökü → Genel Bakış özet dashboard'una redirect (UI/IA reorg A1.5).
 *
 * Eski bookmark'lar yeni ana sayfaya (overview) düşer. Aylık Talep (ay listesi)
 * /dashboard2'de, Üretim hub'ından erişilir. Alt rotalar (/dashboard/manufacturer,
 * /dashboard/month, /dashboard/depolar, /dashboard/shipments vb.) paylaşımlı,
 * çalışmaya devam eder.
 */

import { redirect } from 'next/navigation';

export default function DashboardRootRedirect() {
  redirect('/dashboard/overview');
}
