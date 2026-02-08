/**
 * Dashboard Layout
 * Main layout for authenticated dashboard pages
 */

'use client';

import { ReactNode } from 'react';
import { Header } from '@/components/ui/Header';
import { AuthProvider } from '@/contexts/AuthContext';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <Header />

        {/* Main Content */}
        <main className="p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </AuthProvider>
  );
}
