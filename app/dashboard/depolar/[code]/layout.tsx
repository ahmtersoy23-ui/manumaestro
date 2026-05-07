/**
 * Depo Detay Layout — sekmeler.
 * URL parametresi `code` aslında SLUG'dur (somerset/fairfield/ankara).
 * Eski büyük-harf URL'ler (NJ/SHOWROOM/ANKARA) yeni slug'a redirect olur.
 * Backend code (NJ/SHOWROOM/ANKARA) child sayfalarda slugToCode ile bulunur.
 */

'use client';

import { ReactNode, use, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, LayoutGrid, PackageOpen, ChevronRight, ClipboardCheck } from 'lucide-react';
import {
  warehouseLabelLong,
  slugToCode,
  codeToSlug,
  isLegacyCode,
} from '@/lib/warehouseLabels';

export default function DepoDetayLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code: rawParam } = use(params);
  const pathname = usePathname();
  const router = useRouter();

  // Eski URL geriye uyum: /depolar/SHOWROOM/... → /depolar/fairfield/...
  useEffect(() => {
    if (isLegacyCode(rawParam)) {
      const newPath = pathname.replace(`/depolar/${rawParam}`, `/depolar/${codeToSlug(rawParam)}`);
      router.replace(newPath);
    }
  }, [rawParam, pathname, router]);

  const code = slugToCode(rawParam);
  if (!code) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        Bilinmeyen depo: <span className="font-mono">{rawParam}</span>
      </div>
    );
  }

  const slug = codeToSlug(code);
  const showOutbound = code !== 'ANKARA';
  const baseHref = `/dashboard/depolar/${slug}`;

  const tabs = [
    { href: baseHref, label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: `${baseHref}/raf`, label: 'Depo İşlem', icon: LayoutGrid, exact: false },
    ...(showOutbound
      ? [{ href: `${baseHref}/siparis`, label: 'Sipariş Çıkış', icon: PackageOpen, exact: false }]
      : []),
    { href: `${baseHref}/sayim`, label: 'Sayım', icon: ClipboardCheck, exact: false },
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
        <span className="text-gray-900 font-medium">{warehouseLabelLong(code)}</span>
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
