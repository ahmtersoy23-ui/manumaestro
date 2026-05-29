/**
 * Root Page
 * Dashboard 2'ye yönlendirir (yeni varsayılan ana sayfa, 2026-05-29).
 * V1 erişimi /dashboard üzerinden devam ediyor — Header'da "Eski Görünüm" linki var.
 * SSO authentication is handled by middleware.ts.
 */

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard2');
}
