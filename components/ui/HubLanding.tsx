'use client';

/**
 * Grup hub landing sayfası — bir nav grubunun alt-alanlarını kart olarak gösterir.
 * navConfig tek kaynak; kart eklemek = config'e satır eklemek.
 */

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getNavGroup } from '@/lib/nav/navConfig';

export function HubLanding({ groupKey }: { groupKey: string }) {
  const group = getNavGroup(groupKey);
  if (!group?.children?.length) return null;
  const Icon = group.icon;

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-6">
        <span className="rounded-lg bg-gray-900 p-2 text-white">
          <Icon className="w-5 h-5" />
        </span>
        <h1 className="text-2xl font-bold text-gray-900">{group.label}</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {group.children.map((c) => {
          const CIcon = c.icon;
          return (
            <Link
              key={`${c.href}-${c.label}`}
              href={c.href}
              className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm transition-all"
            >
              <span className="rounded-lg bg-gray-100 p-2.5 text-gray-700 group-hover:bg-gray-900 group-hover:text-white transition-colors">
                <CIcon className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 flex items-center gap-1">
                  {c.label}
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </div>
                {c.desc && <div className="text-sm text-gray-500 mt-0.5 leading-snug">{c.desc}</div>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
