/**
 * Seasonal Planning — Auto-redirect (Server Component).
 *
 * Aktif sezon havuzunu DB'den DİREKT çeker (cross-network fetch gerekmez) ve
 * Next.js redirect() ile yönlendirir. Boş ise super-admin için create UI'ını
 * Client Component'e devreder.
 *
 * Önceki client implementasyonu: fetch /api/stock-pools → JSON parse → router.replace
 * Yeni: prisma sorgu (server-side) → redirect (HTTP 307, hızlı + JS gerekmez)
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { isSuperAdmin } from '@/lib/auth/verify';
import { CreatePoolFallback } from './CreatePoolFallback';

export default async function SeasonalPage() {
  const activePool = await prisma.stockPool.findFirst({
    where: { status: { in: ['ACTIVE', 'RELEASING'] } },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  if (activePool) {
    redirect(`/dashboard/seasonal/${activePool.id}`);
  }

  // Aktif havuz yok — yetki kontrolü
  const h = await headers();
  const email = h.get('x-user-email');
  const superAdmin = isSuperAdmin(email);

  if (!superAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-gray-600">Aktif sezon havuzu yok</p>
        </div>
      </div>
    );
  }

  return <CreatePoolFallback />;
}
