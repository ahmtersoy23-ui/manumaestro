/**
 * Header Component
 * Top navigation bar with branding and user menu
 * Responsive: hamburger menu on mobile
 */

'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Bell, User, LogOut, FileText, Shield, Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function Header() {
  const { user, role, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const roleLabels = {
    admin: 'Yönetici',
    editor: 'Editör',
    viewer: 'İzleyici',
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 relative">
              <Image
                src="/icon.svg"
                alt="ManuMaestro Logo"
                width={40}
                height={40}
                className="w-8 h-8 md:w-10 md:h-10"
              />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-gray-900">ManuMaestro</h1>
              <p className="text-xs text-gray-500 hidden md:block">Üretim Mükemmelliğini Yönetin</p>
            </div>
          </div>

          {/* Desktop: Right side */}
          <div className="hidden md:flex items-center gap-4">
            <button className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
            </button>

            {role === 'admin' && (
              <>
                <Link
                  href="/dashboard/admin/permissions"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Pazar Yeri İzinleri"
                >
                  <Shield className="w-4 h-4" />
                  <span className="hidden lg:inline">İzinler</span>
                </Link>
                <Link
                  href="/dashboard/logs"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                  title="İşlem Geçmişi"
                >
                  <FileText className="w-4 h-4" />
                  <span className="hidden lg:inline">Geçmiş</span>
                </Link>
              </>
            )}

            <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user?.name || 'Kullanıcı'}</p>
                <p className="text-xs text-gray-500">{role ? roleLabels[role] : 'Yükleniyor...'}</p>
              </div>
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt={user.name}
                  className="w-10 h-10 rounded-full"
                />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
              )}
              <button
                onClick={logout}
                className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Çıkış"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Mobile: Hamburger + user avatar */}
          <div className="flex md:hidden items-center gap-2">
            {user?.picture ? (
              <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            )}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-gray-200 space-y-1">
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{user?.name || 'Kullanıcı'}</p>
                <p className="text-xs text-gray-500">{role ? roleLabels[role] : ''}</p>
              </div>
            </div>

            {role === 'admin' && (
              <>
                <Link
                  href="/dashboard/admin/permissions"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  <Shield className="w-4 h-4" />
                  İzin Yönetimi
                </Link>
                <Link
                  href="/dashboard/logs"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  <FileText className="w-4 h-4" />
                  İşlem Geçmişi
                </Link>
              </>
            )}

            <button
              onClick={logout}
              className="flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg w-full"
            >
              <LogOut className="w-4 h-4" />
              Çıkış Yap
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
