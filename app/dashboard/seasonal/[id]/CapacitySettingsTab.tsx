/**
 * Aylık Üretim Kapasitesi Ayar Tab'ı
 *
 * Süper-admin: her ay için günlük desi + çalışma günü girer.
 * Aylık tavan = dailyDesi × workingDays (örn. 500 × 22 = 11.000 desi/ay).
 *
 * İleride: sezonsal allocator + sezonsal SKU üst sınır kriteri bu rakamı kullanır
 * (gün*600 desi gibi). Şimdilik sadece ayar UI; allocator entegrasyonu ileride.
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Plus } from 'lucide-react';
import { notify } from '@/lib/ui/notify';

interface CapacityRow {
  id: string;
  month: string;
  dailyDesi: number;
  workingDays: number;
  notes: string | null;
  updatedAt: string;
  updatedBy?: { name: string; email: string } | null;
}

export function CapacitySettingsTab() {
  const [rows, setRows] = useState<CapacityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  // Yeni ay ekleme form state
  const [newMonth, setNewMonth] = useState('');
  const [newDaily, setNewDaily] = useState(500);
  const [newDays, setNewDays] = useState(22);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/seasonal/capacity');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? 'Hata');
      setRows(data.data);
    } catch (err) {
      notify.error('Kapasite okunamadı', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const upsert = async (month: string, dailyDesi: number, workingDays: number, notes?: string | null) => {
    setSaving(month);
    try {
      const res = await fetch('/api/seasonal/capacity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, dailyDesi, workingDays, notes: notes ?? null }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? 'Hata');
      notify.success(`${month} kapasitesi kaydedildi`);
      await load();
    } catch (err) {
      notify.error('Kapasite kaydedilemedi', err);
    } finally {
      setSaving(null);
    }
  };

  const handleRowChange = (i: number, field: keyof CapacityRow, val: unknown) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  };

  const handleAddNew = async () => {
    if (!/^\d{4}-\d{2}$/.test(newMonth)) {
      notify.error('Ay YYYY-MM formatında olmalı (örn. 2026-06)');
      return;
    }
    await upsert(newMonth, newDaily, newDays);
    setNewMonth('');
    setNewDaily(500);
    setNewDays(22);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
        <strong>Aylık Üretim Kapasitesi:</strong> Atölyenin günlük üretebileceği desi miktarı ×
        ayın çalışma günü = ayın üretim tavanı. İleride sezonsal allocator + sezonsal SKU üst sınır
        kriteri (örn. <code>gün × 600 desi</code>) bu rakamı kullanacak. Şu an sadece ayar/kayıt.
      </div>

      {/* Yeni ay ekleme */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Yeni Ay Ekle / Güncelle
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Ay (YYYY-MM)</label>
            <input
              type="text"
              placeholder="2026-06"
              value={newMonth}
              onChange={e => setNewMonth(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Günlük Desi</label>
            <input
              type="number" min={0} max={100000}
              value={newDaily}
              onChange={e => setNewDaily(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Çalışma Günü</label>
            <input
              type="number" min={0} max={31}
              value={newDays}
              onChange={e => setNewDays(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <button
            onClick={handleAddNew}
            disabled={saving !== null || !newMonth}
            className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {saving === newMonth ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Kaydet ({newDaily * newDays} desi/ay)
          </button>
        </div>
      </div>

      {/* Mevcut kayıtlar */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Ay</th>
              <th className="text-right px-4 py-2 font-medium">Günlük Desi</th>
              <th className="text-right px-4 py-2 font-medium">Çalışma Günü</th>
              <th className="text-right px-4 py-2 font-medium">Aylık Toplam</th>
              <th className="text-left px-4 py-2 font-medium">Notlar</th>
              <th className="text-left px-4 py-2 font-medium">Son Güncelleme</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Henüz kapasite ayarı yok. Yukarıdan bir ay ekleyin.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-purple-700">{r.month}</td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number" min={0} max={100000}
                    value={r.dailyDesi}
                    onChange={e => handleRowChange(i, 'dailyDesi', Number(e.target.value))}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number" min={0} max={31}
                    value={r.workingDays}
                    onChange={e => handleRowChange(i, 'workingDays', Number(e.target.value))}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right font-semibold text-gray-900">
                  {(r.dailyDesi * r.workingDays).toLocaleString('tr-TR')}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={r.notes ?? ''}
                    placeholder="Not (opsiyonel)"
                    onChange={e => handleRowChange(i, 'notes', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                  />
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {new Date(r.updatedAt).toLocaleDateString('tr-TR')}
                  {r.updatedBy && <div className="text-gray-400">{r.updatedBy.name}</div>}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => upsert(r.month, r.dailyDesi, r.workingDays, r.notes)}
                    disabled={saving === r.month}
                    className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {saving === r.month ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Kaydet
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
