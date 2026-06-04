/**
 * Somerset (NJ) Transfer sekmesi.
 * Fairfield'a transfer önerileri (iki koşul: Fairfield çıkışı + Somerset koli kırma).
 * Her satır → modal ile NJ kaynağından SHOWROOM POOL rafına cross-warehouse transfer.
 * Yalnız NJ deposunda; diğer depolarda dashboard'a yönlenir.
 */

'use client';

import { useEffect, useState, use, useCallback } from 'react';
import { redirect } from 'next/navigation';
import { ArrowLeftRight, AlertCircle, RefreshCw, EyeOff } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { slugToCode, codeToSlug } from '@/lib/warehouseLabels';
import { TransferToFairfieldModal } from '@/components/wms/TransferToFairfieldModal';

const logger = createLogger('TransferTab');

interface RecItem {
  iwasku: string;
  name: string | null;
  nj: number;
  reasons: ('SHOWROOM_OUT' | 'BOX_OPEN')[];
  lastEvent: string;
}
interface RecData {
  role: string;
  canTransfer: boolean;
  destination: { id: string; code: string } | null;
  items: RecItem[];
}

const REASON_LABEL: Record<string, { text: string; cls: string }> = {
  SHOWROOM_OUT: { text: "Fairfield'da bitti", cls: 'bg-indigo-100 text-indigo-700' },
  BOX_OPEN: { text: 'Koli kırıldı', cls: 'bg-amber-100 text-amber-700' },
};

export default function TransferTabPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = slugToCode(rawCode) ?? rawCode.toUpperCase();

  // Transfer önerileri yalnız Somerset (NJ) için anlamlı.
  if (code !== 'NJ') {
    redirect(`/dashboard/depolar/${codeToSlug(code)}`);
  }

  const [data, setData] = useState<RecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ iwasku: string; name: string | null } | null>(null);

  const fetchData = useCallback(() => {
    fetch(`/api/depolar/${code}/transfer/recommendations`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.data);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        logger.error('recommendations fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => setLoading(false));
  }, [code]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const undismiss = useCallback(
    (iwasku: string) => {
      fetch(`/api/depolar/${code}/transfer/dismiss`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku }),
      })
        .then(() => fetchData())
        .catch((e) => logger.error('undismiss', e));
    },
    [code, fetchData]
  );

  const dismiss = useCallback(
    async (iwasku: string) => {
      try {
        const res = await fetch(`/api/depolar/${code}/transfer/dismiss`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ iwasku }),
        });
        const d = await res.json();
        if (!res.ok || !d.success) {
          notify.error(d.error || 'Yok sayılamadı');
          return;
        }
        fetchData();
        toast((t) => (
          <span className="flex items-center gap-3 text-sm">
            Öneri yok sayıldı
            <button
              onClick={() => {
                toast.dismiss(t.id);
                undismiss(iwasku);
              }}
              className="text-indigo-600 font-medium hover:underline"
            >
              Geri al
            </button>
          </span>
        ));
      } catch (e) {
        logger.error('dismiss', e);
        notify.error('Sunucu hatası');
      }
    },
    [code, fetchData, undismiss]
  );

  if (loading && !data) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-indigo-600" />
            Fairfield&apos;a Transfer Önerileri
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Fairfield&apos;da bitmiş veya Somerset&apos;te koli kırılmış, Somerset&apos;te stoğu olan ürünler.
            Transfer yapınca satır otomatik düşer.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
          title="Yenile"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Yenile
        </button>
      </div>

      {!data.destination && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Fairfield&apos;da POOL rafı bulunamadı — transfer hedefi yok. Fairfield deposunda bir POOL raf tanımlayın.
        </div>
      )}

      {data.items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-10 text-sm text-gray-400 text-center">
          Transfer önerisi yok.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Ürün</th>
                <th className="text-left px-4 py-2">Sebep</th>
                <th className="text-right px-4 py-2">Somerset stok</th>
                <th className="text-left px-4 py-2">Son olay</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((it) => (
                <tr key={it.iwasku} className="text-gray-700">
                  <td className="px-4 py-2">
                    <span className="text-gray-800">{it.name ?? it.iwasku}</span>
                    {it.name && (
                      <span className="ml-1.5 font-mono text-[10px] text-gray-400">{it.iwasku}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {it.reasons.map((r) => (
                        <span
                          key={r}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${REASON_LABEL[r]?.cls ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {REASON_LABEL[r]?.text ?? r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-indigo-700">{it.nj}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(it.lastEvent).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {data.canTransfer && data.destination && (
                        <button
                          onClick={() => setModal({ iwasku: it.iwasku, name: it.name })}
                          className="text-[11px] text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 rounded"
                        >
                          Fairfield&apos;a Transfer Et
                        </button>
                      )}
                      {data.canTransfer && (
                        <button
                          onClick={() => dismiss(it.iwasku)}
                          title="Bu öneriyi yok say (yeni bir hareket olursa tekrar belirir)"
                          className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!data.canTransfer && <span className="text-[11px] text-gray-400">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && data.destination && (
        <TransferToFairfieldModal
          warehouseCode={code}
          iwasku={modal.iwasku}
          productName={modal.name}
          destinationShelfId={data.destination.id}
          destinationLabel={data.destination.code}
          onClose={() => setModal(null)}
          onDone={fetchData}
        />
      )}
    </div>
  );
}
