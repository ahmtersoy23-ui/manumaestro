/**
 * /dashboard kökü → Dashboard 2'ye redirect (2026-05-29).
 *
 * V1 ana sayfa (ay listesi) Dashboard 2'de zaten mevcut (paritede). Eski
 * bookmark'lar otomatik yeni ana sayfaya düşer. Alt rotalar (/dashboard/
 * manufacturer, /dashboard/month, /dashboard/depolar, /dashboard/shipments,
 * vb.) paylaşımlı sayfalardır ve çalışmaya devam eder.
 */

import { redirect } from 'next/navigation';

export default function DashboardRootRedirect() {
  redirect('/dashboard2');
}
