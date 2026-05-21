'use client';

/**
 * Mobil İşlem Hub — kameralı depo işlemlerine giriş noktası.
 * Telefondan açıldığında 4 ana işlem kartı gösterir.
 * Her kart kendi alt sayfasına yönlendirir; yeni özellikler buraya eklenir.
 */

import { use } from 'react';
import Link from 'next/link';
import { Camera, PackagePlus, ArrowRightLeft, Truck, ChevronRight } from 'lucide-react';
import { slugToCode, warehouseLabelLong } from '@/lib/warehouseLabels';

interface ActionCard {
  href: string | null;
  label: string;
  description: string;
  icon: typeof Camera;
  status?: 'ready' | 'soon';
}

export default function MobilHubPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawParam } = use(params);
  const code = slugToCode(rawParam);

  if (!code) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        Bilinmeyen depo: <span className="font-mono">{rawParam}</span>
      </div>
    );
  }

  const cards: ActionCard[] = [
    {
      href: `/dashboard/depolar/${rawParam}/mobil/stok-kabul`,
      label: 'Stok Kabul',
      description: 'Üretimden gelen ürünleri kamera ile okutup depoya al',
      icon: Camera,
      status: 'ready',
    },
    {
      href: `/dashboard/depolar/${rawParam}/mobil/rafa-yerlestir`,
      label: 'Rafa Yerleştirme',
      description: 'POOL\'daki ürünleri kamera ile raflara dağıt',
      icon: PackagePlus,
      status: 'ready',
    },
    {
      href: null,
      label: 'Raf → Raf Transfer',
      description: 'Bir raftaki ürünü başka bir rafa taşı',
      icon: ArrowRightLeft,
      status: 'soon',
    },
    {
      href: null,
      label: 'Sipariş Çıkışı (Picking)',
      description: 'Siparişleri rafdan toplarken kamera ile doğrula',
      icon: Truck,
      status: 'soon',
    },
  ];

  return (
    <div className="max-w-md md:mx-auto">
      <div className="mb-4">
        <div className="text-[11px] uppercase text-gray-500 tracking-wide">Mobil İşlem</div>
        <div className="text-base font-semibold text-gray-900">{warehouseLabelLong(code)}</div>
      </div>

      <div className="space-y-3">
        {cards.map((c) => {
          const Icon = c.icon;
          const disabled = c.status !== 'ready' || !c.href;
          const inner = (
            <>
              <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                <Icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-gray-900">{c.label}</div>
                  {c.status === 'soon' && (
                    <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                      Yakında
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600 mt-0.5">{c.description}</div>
              </div>
              {!disabled && <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />}
            </>
          );

          if (disabled) {
            return (
              <div
                key={c.label}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 opacity-60 cursor-not-allowed"
              >
                {inner}
              </div>
            );
          }

          return (
            <Link
              key={c.label}
              href={c.href as string}
              className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:border-blue-400 hover:shadow-sm transition-all"
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
