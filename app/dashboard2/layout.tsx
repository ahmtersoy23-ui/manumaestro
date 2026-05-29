/**
 * Dashboard 2 Layout
 * V1 ile aynı top navigation (Header) — Dashboard 2 sayfaları kendi padding'ine sahip,
 * burada ekstra padding YOK.
 */

'use client';

import { ReactNode } from 'react';
import { Header } from '@/components/ui/Header';
import { AuthProvider } from '@/contexts/AuthContext';

export default function Dashboard2Layout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main id="main-content">{children}</main>
      </div>
    </AuthProvider>
  );
}
