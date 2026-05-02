/**
 * Depo Detay Layout — 3 sekme: Dashboard | Raf | Sipariş Çıkış
 * Sipariş sekmesi yalnız NJ + SHOWROOM'da görünür (ANKARA'da gizli).
 */

'use client';

import { ReactNode, use } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, LayoutGrid, PackageOpen, ChevronRight } from 'lucide-react';

const VALID_CODES = ['ANKARA', 'NJ', 'SHOWROOM'] as const;
type WarehouseCode = (typeof VALID_CODES)[number];

const WAREHOUSE_LABELS: Record<WarehouseCode, string> = {
  ANKARA: 'Ankara Depo',
  NJ: 'Somerset Depo',
  SHOWROOM: 'Fairfield Depo',
};

export default function DepoDetayLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase() as WarehouseCode;
  const pathname = usePathname();

  if (!VALID_CODES.includes(code)) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        Bilinmeyen depo: <span className="font-mono">{rawCode}</span>
      </div>
    );
  }

  const showOutbound = code !== 'ANKARA';
  const baseHref = `/dashboard/depolar/${code}`;

  const tabs = [
    { href: baseHref, label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: `${baseHref}/raf`, label: 'Raf Düzeni', icon: LayoutGrid, exact: false },
    ...(showOutbound
      ? [{ href: `${baseHref}/siparis`, label: 'Sipariş Çıkış', icon: PackageOpen, exact: false }]
      : []),
  ];

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/dashboard/depolar" className="hover:text-gray-900">
          Depolar
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900 font-medium">{WAREHOUSE_LABELS[code]}</span>
      </nav>

      {/* Tab navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.href, tab.exact);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`whitespace-nowrap flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div>{children}</div>
    </div>
  );
}
