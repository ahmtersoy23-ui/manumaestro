/**
 * Marketplace Priority Component
 * Drag-and-drop ordering of marketplaces for waterfall completion
 * Shows current completion status per marketplace
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { GripVertical, Save, Loader2, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

interface Marketplace {
  id: string;
  name: string;
  code: string;
  region: string;
}

interface PriorityItem {
  marketplaceId: string;
  marketplace: Marketplace;
  priority: number;
}

interface Props {
  month: string;
}

export function MarketplacePriority({ month }: Props) {
  const [priorities, setPriorities] = useState<PriorityItem[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [prioRes, mpRes] = await Promise.all([
        fetch(`/api/marketplace-priorities?month=${month}`),
        fetch('/api/marketplaces'),
      ]);
      const prioData = await prioRes.json();
      const mpData = await mpRes.json();

      const activeMarketplaces: Marketplace[] = (mpData.data || []).filter((m: Marketplace & { isActive: boolean }) => m.isActive);
      setMarketplaces(activeMarketplaces);

      const dbPriorities: PriorityItem[] = (prioData.success && prioData.data) ? prioData.data : [];

      if (dbPriorities.length === 0) {
        // Hiç priority kaydı yoksa: tüm aktif marketplace'leri default sıralı göster
        const defaultPriorities = activeMarketplaces.map((mp, idx) => ({
          marketplaceId: mp.id,
          marketplace: mp,
          priority: idx + 1,
        }));
        setPriorities(defaultPriorities);
      } else {
        // Kısmi kayıt varsa: DB'dekiler + DB'de olmayan aktif marketplace'leri sona ekle
        const dbIds = new Set(dbPriorities.map(p => p.marketplaceId));
        const missing = activeMarketplaces.filter(mp => !dbIds.has(mp.id));
        const maxPriority = dbPriorities.reduce((m, p) => Math.max(m, p.priority), 0);
        const appended = missing.map((mp, idx) => ({
          marketplaceId: mp.id,
          marketplace: mp,
          priority: maxPriority + idx + 1,
        }));
        setPriorities([...dbPriorities, ...appended]);
        if (appended.length > 0) setDirty(true);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;

    setPriorities(prev => {
      const items = [...prev];
      const dragged = items[dragIdx]!;
      items.splice(dragIdx, 1);
      items.splice(idx, 0, dragged);
      // Re-number priorities
      return items.map((item, i) => ({ ...item, priority: i + 1 }));
    });
    setDragIdx(idx);
    setDirty(true);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/marketplace-priorities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          priorities: priorities.map(p => ({
            marketplaceId: p.marketplaceId,
            priority: p.priority,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) setDirty(false);
      else alert(data.error);
    } catch {
      alert('Kayıt hatası');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Pazaryeri Öncelikleri</h3>
          <p className="text-xs text-gray-500">Sürükle-bırak ile sıralayın. Üstteki pazaryeri önce tamamlanır.</p>
        </div>
        {dirty && (
          <button
            onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Kaydet
          </button>
        )}
      </div>

      <div className="space-y-1">
        {priorities.map((item, idx) => (
          <div
            key={item.marketplaceId}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={e => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 px-3 py-2.5 bg-white border rounded-lg cursor-grab active:cursor-grabbing transition-all ${
              dragIdx === idx ? 'border-purple-400 shadow-md scale-[1.02]' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
            <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500">
              {item.priority}
            </span>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-gray-900 text-sm">{item.marketplace?.name || item.marketplaceId}</span>
              <span className="text-xs text-gray-400 ml-2">{item.marketplace?.region}</span>
            </div>
          </div>
        ))}
      </div>

      {priorities.length === 0 && (
        <p className="text-center text-gray-400 text-sm py-4">Aktif pazaryeri bulunamadı</p>
      )}
    </div>
  );
}
