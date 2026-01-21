/**
 * Header Component
 * Top navigation bar with branding and user menu
 */

'use client';

import Image from 'next/image';
import { Bell, User, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function Header() {
  const { user, role, logout } = useAuth();

  const roleLabels = {
    admin: 'Administrator',
    editor: 'Editor',
    viewer: 'Viewer',
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 relative">
              <Image
                src="/icon.svg"
                alt="ManuMaestro Logo"
                width={40}
                height={40}
                className="w-10 h-10"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">ManuMaestro</h1>
              <p className="text-xs text-gray-500">Orchestrating Production Excellence</p>
            </div>
          </div>

          {/* Right side - Notifications & User */}
          <div className="flex items-center gap-4">
            {/* Notifications */}
            <button className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
            </button>

            {/* User Menu */}
            <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user?.name || 'User'}</p>
                <p className="text-xs text-gray-500">{role ? roleLabels[role] : 'Loading...'}</p>
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
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
