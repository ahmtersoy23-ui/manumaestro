/**
 * Cycle count (Sayım) sekmesi — task listesi + manuel generate.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ClipboardCheck, AlertCircle, RefreshCw, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SayimList');

interface TaskRow {
  id: string;
  shelfId: string;
  shelfCode: string;
  shelfType: string;
  abcClass: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISCREPANCY';
  scheduledFor: string;
  toleranceQty: number;
  startedAt: string | null;
  completedAt: string | null;
  itemCount: number;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  DISCREPANCY: 'bg-red-100 text-red-700',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Bekliyor',
  IN_PROGRESS: 'Sayılıyor',
  COMPLETED: 'Tamamlandı',
  DISCREPANCY: 'Sapma var',
};

const ABC_BADGE: Record<string, string> = {
  A: 'bg-red-100 text-red-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-gray-100 text-gray-700',
};

export default function SayimListPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [role, setRole] = useState<string>('VIEWER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISCREPANCY'>('ALL');
  const [refreshKey, setRefreshKey] = useState(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    fetch(`/api/depolar/${code}/sayim?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setTasks(d.data.tasks);
          setRole(d.data.role ?? 'VIEWER');
        } else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Sayim fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, statusFilter, refreshKey]);

  const canGenerate = ['MANAGER', 'ADMIN'].includes(role);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/depolar/${code}/sayim/generate`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        alert(d.error || 'Generate başarısız');
        return;
      }
      const r = d.data;
      alert(
        `Üretildi: ${r.created} | Atlandı: ${r.skipped} | Değerlendirildi: ${r.evaluated}` +
          (r.capped ? ' (günlük limite ulaşıldı)' : '')
      );
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Generate', e);
      alert('Sunucu hatası');
    } finally {
      setGenerating(false);
    }
  }

  const counts = {
    pending: tasks.filter((t) => t.status === 'PENDING').length,
    inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    completed: tasks.filter((t) => t.status === 'COMPLETED').length,
    discrepancy: tasks.filter((t) => t.status === 'DISCREPANCY').length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-gray-500" />
            Sayım Görevleri
          </h1>
          <p className="text-xs text-gray-500">
            Bekleyen: {counts.pending} • Sayılıyor: {counts.inProgress} •
            Tamamlandı: {counts.completed} • Sapma: {counts.discrepancy}
          </p>
        </div>
        {canGenerate && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
            title="ABC sınıfına göre yeni sayım görevleri üret"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Görev Üret
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {(['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${
              statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'ALL' ? 'Hepsi' : STATUS_LABEL[s]}
          </button>
        ))}
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="ml-auto p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
          title="Yenile"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg">
        {loading ? (
          <div className="px-4 py-8 text-sm text-gray-400 text-center">Yükleniyor…</div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-8 text-sm text-gray-400 text-center">
            Bu filtre için görev yok. {canGenerate && 'Üst sağdaki "Görev Üret" butonuyla başlat.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/dashboard/depolar/${code}/sayim/${task.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                >
                  <span
                    className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[task.status]}`}
                  >
                    {STATUS_LABEL[task.status]}
                  </span>
                  {task.abcClass && (
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-bold ${ABC_BADGE[task.abcClass]}`}>
                      {task.abcClass}
                    </span>
                  )}
                  <span className="font-mono text-sm font-medium text-gray-900">{task.shelfCode}</span>
                  <span className="text-[11px] text-gray-500">{task.shelfType}</span>
                  <span className="ml-auto text-xs text-gray-500 flex items-center gap-3">
                    <span>Tolerans: {task.toleranceQty}</span>
                    <span>{task.itemCount} kalem</span>
                    <span className="hidden md:inline">
                      {new Date(task.scheduledFor).toLocaleDateString('tr-TR')}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
