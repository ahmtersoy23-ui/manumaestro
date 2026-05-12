'use client';

/**
 * Aktif sezon havuzu yokken super-admin için "Sezon Oluştur" UI'ı.
 * Server Component SeasonalPage'in client fallback'i.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { notify } from '@/lib/ui/notify';

export function CreatePoolFallback() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/stock-pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sezon', code: 'SEZON', poolType: 'SEASONAL' }),
      });
      const data = await res.json();
      if (data.success) {
        router.replace(`/dashboard/seasonal/${data.data.id}`);
      } else {
        notify.error(data.error || 'Havuz oluşturulamadı');
        setCreating(false);
      }
    } catch (e) {
      notify.error('Bağlantı hatası', e);
      setCreating(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Aktif sezon havuzu yok</h2>
        <p className="text-sm text-gray-600 mb-4">Yeni bir sezon oluşturmak ister misiniz?</p>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {creating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Oluşturuluyor…</>
          ) : (
            <><Plus className="w-4 h-4" /> Sezon Oluştur</>
          )}
        </button>
      </div>
    </div>
  );
}
