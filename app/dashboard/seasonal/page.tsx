/**
 * Seasonal Planning — Auto-redirect
 * Finds the active seasonal pool (or creates one) and redirects to its detail page.
 * There is always exactly one active seasonal pool.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function SeasonalPage() {
  const { role } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    if (role !== 'admin') return;

    (async () => {
      try {
        // Check for existing active/releasing seasonal pool
        const res = await fetch('/api/stock-pools');
        const data = await res.json();
        if (!data.success) { setError('Havuz verileri alınamadı'); return; }

        const activePool = data.data.find(
          (p: { status: string }) => p.status === 'ACTIVE' || p.status === 'RELEASING'
        );

        if (activePool) {
          router.replace(`/dashboard/seasonal/${activePool.id}`);
          return;
        }

        // No active pool — create one automatically
        const createRes = await fetch('/api/stock-pools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Sezon',
            code: 'SEZON',
            poolType: 'SEASONAL',
          }),
        });
        const createData = await createRes.json();
        if (createData.success) {
          router.replace(`/dashboard/seasonal/${createData.data.id}`);
        } else {
          setError(createData.error || 'Havuz oluşturulamadı');
        }
      } catch {
        setError('Bağlantı hatası');
      }
    })();
  }, [role, router]);

  if (role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <AlertCircle className="w-12 h-12 text-red-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
    </div>
  );
}
