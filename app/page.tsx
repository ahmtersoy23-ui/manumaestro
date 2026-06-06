/**
 * Root Page
 * Genel Bakış özet dashboard'una yönlendirir (yeni ana sayfa, UI/IA reorg A1.5).
 * Aylık Talep (eski Dashboard 2 ay listesi) Üretim hub'ından erişilir.
 * SSO authentication is handled by middleware.ts.
 */

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard/overview');
}
