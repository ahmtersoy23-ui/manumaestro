/**
 * Navigation Component
 * Sidebar navigation with marketplace links
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Factory,
  Settings,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const navSections = [
  {
    title: 'Main',
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
      },
      {
        label: 'Manufacturer',
        href: '/dashboard/manufacturer',
        icon: Factory,
      },
    ],
  },
  {
    title: 'Marketplaces',
    items: [
      {
        label: 'Amazon US',
        href: '/dashboard/marketplace/amzn-us',
        color: 'bg-orange-100 text-orange-700',
      },
      {
        label: 'Amazon EU',
        href: '/dashboard/marketplace/amzn-eu',
        color: 'bg-orange-100 text-orange-700',
      },
      {
        label: 'Amazon UK',
        href: '/dashboard/marketplace/amzn-uk',
        color: 'bg-orange-100 text-orange-700',
      },
      {
        label: 'Amazon CA',
        href: '/dashboard/marketplace/amzn-ca',
        color: 'bg-orange-100 text-orange-700',
      },
      {
        label: 'Amazon AU',
        href: '/dashboard/marketplace/amzn-au',
        color: 'bg-orange-100 text-orange-700',
      },
      {
        label: 'Wayfair US',
        href: '/dashboard/marketplace/wayfair-us',
        color: 'bg-purple-100 text-purple-700',
      },
      {
        label: 'Wayfair UK',
        href: '/dashboard/marketplace/wayfair-uk',
        color: 'bg-purple-100 text-purple-700',
      },
      {
        label: 'Takealot',
        href: '/dashboard/marketplace/takealot-za',
        color: 'bg-blue-100 text-blue-700',
      },
      {
        label: 'Bol',
        href: '/dashboard/marketplace/bol-nl',
        color: 'bg-cyan-100 text-cyan-700',
      },
    ],
  },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="w-64 bg-white border-r border-gray-200 min-h-screen sticky top-16 overflow-y-auto">
      <div className="p-4 space-y-6">
        {navSections.map((section) => (
          <div key={section.title}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-3">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                const Icon = 'icon' in item ? item.icon : null;
                const color = 'color' in item ? item.color : undefined;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-purple-50 text-purple-700'
                          : 'text-gray-700 hover:bg-gray-50',
                        color
                      )}
                    >
                      {Icon && <Icon className="w-4 h-4" />}
                      {!Icon && (
                        <div
                          className={cn(
                            'w-2 h-2 rounded-full',
                            color || 'bg-gray-300'
                          )}
                        />
                      )}
                      <span className="flex-1">{item.label}</span>
                      {isActive && <ChevronRight className="w-4 h-4" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
