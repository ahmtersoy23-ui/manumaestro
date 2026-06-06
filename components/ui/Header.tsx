/**
 * Header Component
 * Üst navigasyon — 4 ana grup (Üretim/Stok/Sevkiyat/Sipariş), navConfig tek kaynak.
 * Admin öğeleri (İzinler/Geçmiş) kullanıcı menüsünde. Responsive: mobilde hamburger.
 */

'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, LogOut, Menu, X, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { NAV_GROUPS, ADMIN_LINKS, HOME_HREF, type NavGroup } from '@/lib/nav/navConfig';

const roleLabels = {
  admin: 'Yönetici',
  editor: 'Editör',
  viewer: 'İzleyici',
} as const;

export function Header() {
  const { user, role, canViewStock, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const groups = NAV_GROUPS.filter((g) => !g.requireStock || canViewStock);

  const isActive = (g: NavGroup): boolean => {
    if (pathname === g.href || pathname.startsWith(`${g.href}/`)) return true;
    return (g.children ?? []).some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`));
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href={HOME_HREF} className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 md:w-10 md:h-10 relative">
              <Image src="/icon.svg" alt="ManuMaestro Logo" width={40} height={40} className="w-8 h-8 md:w-10 md:h-10" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-gray-900">ManuMaestro</h1>
              <p className="text-xs text-gray-500 hidden md:block">Üretim Mükemmelliğini Yönetin</p>
            </div>
          </Link>

          {/* Desktop: 4 ana grup */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {groups.map((g) => {
              const Icon = g.icon;
              const active = isActive(g);
              return (
                <Link
                  key={g.key}
                  href={g.href}
                  title={g.label}
                  className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                    active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden lg:inline">{g.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Desktop: kullanıcı menüsü */}
          <div className="hidden md:flex items-center shrink-0 relative">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-3 pl-4 border-l border-gray-200 hover:opacity-80 transition-opacity"
            >
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user?.name || 'Kullanıcı'}</p>
                <p className="text-xs text-gray-500">{role ? roleLabels[role] : 'Yükleniyor...'}</p>
              </div>
              {user?.picture ? (
                <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
              )}
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-gray-200 bg-white shadow-lg z-50 py-1.5">
                  {role === 'admin' && (
                    <>
                      {ADMIN_LINKS.map((a) => {
                        const AIcon = a.icon;
                        return (
                          <Link
                            key={a.href}
                            href={a.href}
                            onClick={() => setUserMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            <AIcon className="w-4 h-4 text-gray-500" /> {a.label}
                          </Link>
                        );
                      })}
                      <div className="my-1.5 border-t border-gray-100" />
                    </>
                  )}
                  <button
                    onClick={() => { setUserMenuOpen(false); logout(); }}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 w-full"
                  >
                    <LogOut className="w-4 h-4" /> Çıkış Yap
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Mobile: avatar + hamburger */}
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

        {/* Mobile menü */}
        {menuOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-gray-200 space-y-1">
            <div className="px-3 py-2 mb-1">
              <p className="text-sm font-medium text-gray-900">{user?.name || 'Kullanıcı'}</p>
              <p className="text-xs text-gray-500">{role ? roleLabels[role] : ''}</p>
            </div>

            {groups.map((g) => {
              const Icon = g.icon;
              return (
                <Link
                  key={g.key}
                  href={g.href}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg ${
                    isActive(g) ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {g.label}
                </Link>
              );
            })}

            {role === 'admin' && (
              <>
                <div className="my-1 border-t border-gray-100" />
                {ADMIN_LINKS.map((a) => {
                  const AIcon = a.icon;
                  return (
                    <Link
                      key={a.href}
                      href={a.href}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                    >
                      <AIcon className="w-4 h-4" /> {a.label}
                    </Link>
                  );
                })}
              </>
            )}

            <button
              onClick={logout}
              className="flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg w-full"
            >
              <LogOut className="w-4 h-4" /> Çıkış Yap
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
