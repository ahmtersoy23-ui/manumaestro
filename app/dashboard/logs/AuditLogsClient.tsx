'use client';

/**
 * Audit Logs Client — filter dropdown + refresh button.
 * Server Component (page.tsx) prefetched data'yı initialLogs prop'u ile geçirir.
 * Filter değişimi useRouter ile URL searchParams'ı günceller; Next.js RSC
 * yeniden render eder, fresh data prop olarak gelir.
 */

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Filter, RefreshCw, Loader2 } from 'lucide-react';

interface AuditLog {
  id: string;
  userName: string;
  userEmail: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: {
    name: string;
    email: string;
    role: string;
  };
}

interface Props {
  initialLogs: AuditLog[];
  currentFilter: string;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getActionColor(action: string) {
  if (action.startsWith('CREATE')) return 'bg-green-100 text-green-800';
  if (action.startsWith('UPDATE')) return 'bg-blue-100 text-blue-800';
  if (action.startsWith('DELETE')) return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
}

export function AuditLogsClient({ initialLogs, currentFilter }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setFilter = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set('action', value);
    else params.delete('action');
    startTransition(() => {
      router.replace(`?${params.toString()}`);
    });
  };

  const refresh = () => {
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Denetim Kayıtları</h1>
          <p className="text-gray-600 mt-1">Sistem etkinliği ve kullanıcı işlemleri</p>
        </div>
        <button
          onClick={refresh}
          disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Yenile
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <select
            value={currentFilter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={isPending}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
          >
            <option value="">Tüm İşlemler</option>
            <option value="CREATE_REQUEST">Talep Oluştur</option>
            <option value="UPDATE_REQUEST">Talep Güncelle</option>
            <option value="DELETE_REQUEST">Talep Sil</option>
            <option value="CREATE_MARKETPLACE">Pazar Yeri Oluştur</option>
            <option value="UPDATE_PRODUCTION">Üretim Güncelle</option>
            <option value="BULK_UPLOAD">Toplu Yükleme</option>
            <option value="CREATE_ORDER">Sipariş Girildi</option>
            <option value="APPROVE_ORDER">Sipariş Onaylandı</option>
            <option value="LABEL_ORDER">Etiket Alındı</option>
            <option value="CANCEL_LABEL">Etiket İptal</option>
            <option value="CLOSE_ORDER">Sipariş Kapatıldı</option>
            <option value="CANCEL_ORDER">Listeden Düşürüldü</option>
            <option value="DELETE_ORDER">Sipariş Silindi</option>
            <option value="LOGIN">Giriş</option>
            <option value="LOGOUT">Çıkış</option>
          </select>
          {isPending && <Loader2 className="w-4 h-4 animate-spin text-purple-500" />}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {initialLogs.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">Denetim kaydı bulunamadı</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Tarih</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Kullanıcı</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">İşlem</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Açıklama</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Varlık</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">IP Adresi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {initialLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(log.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{log.userName}</p>
                        <p className="text-xs text-gray-500">{log.userEmail}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getActionColor(log.action)}`}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{log.description}</td>
                    <td className="px-4 py-3">
                      {log.entityType && (
                        <div className="text-xs">
                          <p className="text-gray-600">{log.entityType}</p>
                          {log.entityId && (
                            <p className="text-gray-400 font-mono">{log.entityId.slice(0, 8)}...</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{log.ipAddress || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
