'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, RefreshCw, Play, Trash2, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { STOCK_PUSH_CHANNELS, STOCK_WAREHOUSES, WAREHOUSE_LABELS, type StockWarehouse } from '@/lib/stockPush/constants';

interface ConfigRow {
  id: string;
  iwasku: string;
  mode: 'STOCK' | 'ZERO';
  warehouses: string[];
  percent: number;
  floorX: number;
  note: string | null;
}
interface PreviewRow {
  marketplaceSku: string;
  iwasku: string;
  mode: 'STOCK' | 'STANDARD' | 'ZERO';
  quantity: number;
  lastQty: number | null;
  willChange: boolean;
  base?: number;
  belowFloor?: boolean;
  breakdown: { cgMdn: number; cgShukran: number; nj: number; showroom: number };
}
interface Settings { channel: string; standardQty: number; enabled: boolean; dryRun: boolean }

const PAGE_SIZE = 100;

/** API hata alanini her zaman string'e cevir (obje gelirse [object Object] olmasin). */
function errText(j: { error?: unknown }, fallback: string): string {
  const e = j?.error;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') return (e as { message?: string }).message || JSON.stringify(e);
  return fallback;
}

export default function StokPushPage() {
  const [channel, setChannel] = useState('AMAZON_US');
  const ch = STOCK_PUSH_CHANNELS.find((c) => c.key === channel)!;

  const [settings, setSettings] = useState<Settings | null>(null);
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; counts: { stock: number; standard: number; zero: number; total: number }; changedCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // config ekleme formu
  const [fIwasku, setFIwasku] = useState('');
  const [fMode, setFMode] = useState<'STOCK' | 'ZERO'>('STOCK');
  const [fWh, setFWh] = useState<StockWarehouse[]>([...STOCK_WAREHOUSES]);
  const [fPercent, setFPercent] = useState(100);
  const [fFloor, setFFloor] = useState(0);
  const [fNote, setFNote] = useState('');

  // preview filtre
  const [filter, setFilter] = useState<'all' | 'changed' | 'STOCK' | 'ZERO' | 'STANDARD'>('changed');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const loadConfigAndSettings = useCallback(async () => {
    if (!ch.implemented) return;
    setErr(null);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`/api/stock-push/settings?channel=${channel}`, { credentials: 'include' }),
        fetch(`/api/stock-push/config?channel=${channel}`, { credentials: 'include' }),
      ]);
      const sJson = await sRes.json();
      const cJson = await cRes.json();
      if (!sRes.ok || !sJson.success) throw new Error(errText(sJson, 'Ayarlar yüklenemedi'));
      if (!cRes.ok || !cJson.success) throw new Error(errText(cJson, 'Konfig yüklenemedi'));
      setSettings(sJson.settings);
      setConfigs(cJson.configs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hata');
    }
  }, [channel, ch.implemented]);

  const loadPreview = useCallback(async () => {
    if (!ch.implemented) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/stock-push/preview?channel=${channel}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(errText(json, 'Önizleme yüklenemedi'));
      setPreview({ rows: json.rows, counts: json.counts, changedCount: json.changedCount });
      setSettings((s) => (s ? { ...s, standardQty: json.standardQty, enabled: json.enabled, dryRun: json.dryRun } : s));
      setPage(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hata');
    } finally {
      setLoading(false);
    }
  }, [channel, ch.implemented]);

  useEffect(() => {
    setPreview(null);
    setMsg(null);
    loadConfigAndSettings();
  }, [loadConfigAndSettings]);

  const saveSettings = async (patch: Partial<Settings>) => {
    setBusy('settings');
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/stock-push/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel, ...patch }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(errText(json, 'Kaydedilemedi'));
      setSettings(json.settings);
      setMsg('Ayarlar kaydedildi');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hata');
    } finally {
      setBusy(null);
    }
  };

  const addConfig = async () => {
    if (!fIwasku.trim()) return;
    setBusy('config');
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/stock-push/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          channel,
          iwasku: fIwasku.trim(),
          mode: fMode,
          warehouses: fMode === 'STOCK' ? fWh : [],
          percent: fPercent,
          floorX: fFloor,
          note: fNote.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(errText(json, 'Eklenemedi'));
      setFIwasku('');
      setFNote('');
      await loadConfigAndSettings();
      setMsg('Kural kaydedildi');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hata');
    } finally {
      setBusy(null);
    }
  };

  const deleteConfig = async (id: string) => {
    setBusy(`del-${id}`);
    try {
      await fetch(`/api/stock-push/config?id=${id}`, { method: 'DELETE', credentials: 'include' });
      await loadConfigAndSettings();
    } finally {
      setBusy(null);
    }
  };

  const runPush = async (dryRun: boolean) => {
    const live = !dryRun;
    if (live && !confirm('CANLI push — Amazon listing adetleri değişecek. Emin misin?')) return;
    setBusy(dryRun ? 'dryrun' : 'run');
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/stock-push/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel, dryRun }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(errText(json, 'Çalıştırılamadı'));
      const s = json.summary;
      setMsg(
        `${json.dryRun ? '[DRY-RUN] ' : ''}${json.changed} değişiklik · ${s.pushed} yazıldı · ${s.skipped} atlandı · ${s.dryrun} dry · ${s.failed} hata` +
          (json.tierAZeros?.length ? ` · ⚠️ ${json.tierAZeros.length} stok-takipli 0'a indi` : ''),
      );
      await loadPreview();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hata');
    } finally {
      setBusy(null);
    }
  };

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    const q = search.trim().toLowerCase();
    return preview.rows.filter((r) => {
      if (filter === 'changed' && !r.willChange) return false;
      if (filter === 'STOCK' && r.mode !== 'STOCK') return false;
      if (filter === 'ZERO' && r.mode !== 'ZERO') return false;
      if (filter === 'STANDARD' && r.mode !== 'STANDARD') return false;
      if (q && !r.marketplaceSku.toLowerCase().includes(q) && !r.iwasku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [preview, filter, search]);

  const pageRows = filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);

  return (
    <div className="space-y-4 p-1">
      <PageHeader icon={<Upload className="w-6 h-6" />} title="Stok Push" subtitle="Pazar yeri listing'lerine otomatik available gönderimi" />

      {/* Kanal sekmeleri */}
      <div className="flex gap-1 border-b border-gray-200">
        {STOCK_PUSH_CHANNELS.map((c) => (
          <button
            key={c.key}
            onClick={() => c.implemented && setChannel(c.key)}
            disabled={!c.implemented}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              channel === c.key
                ? 'border-blue-600 text-blue-600'
                : c.implemented
                  ? 'border-transparent text-gray-500 hover:text-gray-800'
                  : 'border-transparent text-gray-300 cursor-not-allowed'
            }`}
          >
            {c.label}
            {!c.implemented && <span className="ml-1 text-[10px]">(yakında)</span>}
          </button>
        ))}
      </div>

      {!ch.implemented ? (
        <Card padded>{ch.label} için stok push henüz aktif değil.</Card>
      ) : (
        <>
          {(msg || err) && (
            <div className={`text-sm rounded-lg px-3 py-2 ${err ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{err || msg}</div>
          )}

          {/* Ayarlar + çalıştır */}
          {settings && (
            <Card padded className="space-y-3">
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-sm">
                  <span className="block text-gray-500 mb-1">Standart adet (default herkese)</span>
                  <input
                    type="number"
                    value={settings.standardQty}
                    onChange={(e) => setSettings({ ...settings, standardQty: Number(e.target.value) })}
                    className="w-28 border rounded-lg px-2 py-1.5"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={settings.dryRun} onChange={(e) => setSettings({ ...settings, dryRun: e.target.checked })} />
                  Dry-run (yazma yok)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
                  Aktif (canlı push izni)
                </label>
                <Button size="sm" loading={busy === 'settings'} onClick={() => saveSettings({ standardQty: settings.standardQty, dryRun: settings.dryRun, enabled: settings.enabled })}>
                  Ayarları Kaydet
                </Button>
              </div>
              {!settings.enabled && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Aktif değil — &quot;Çalıştır&quot; her zaman dry-run olur (canlı yazmaz).
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} loading={loading} onClick={loadPreview}>
                  Önizle
                </Button>
                <Button variant="secondary" size="sm" icon={<Play className="w-4 h-4" />} loading={busy === 'dryrun'} onClick={() => runPush(true)}>
                  Çalıştır (dry-run)
                </Button>
                <Button variant="warning" size="sm" icon={<Play className="w-4 h-4" />} loading={busy === 'run'} disabled={!settings.enabled} onClick={() => runPush(false)}>
                  Çalıştır (CANLI)
                </Button>
              </div>
            </Card>
          )}

          {/* Kova kuralları */}
          <Card padded className="space-y-3">
            <h3 className="font-semibold text-gray-800">Kova kuralları (config&apos;te olmayan = standart)</h3>
            <div className="flex flex-wrap items-end gap-3 text-sm bg-gray-50 rounded-lg p-3">
              <label>
                <span className="block text-gray-500 mb-1">iwasku</span>
                <input value={fIwasku} onChange={(e) => setFIwasku(e.target.value)} placeholder="DS002..." className="w-44 border rounded-lg px-2 py-1.5" />
              </label>
              <label>
                <span className="block text-gray-500 mb-1">Kova</span>
                <select value={fMode} onChange={(e) => setFMode(e.target.value as 'STOCK' | 'ZERO')} className="border rounded-lg px-2 py-1.5">
                  <option value="STOCK">STOCK (stok-bazlı)</option>
                  <option value="ZERO">ZERO (discontinued → 0)</option>
                </select>
              </label>
              {fMode === 'STOCK' && (
                <>
                  <div>
                    <span className="block text-gray-500 mb-1">Depolar</span>
                    <div className="flex gap-2">
                      {STOCK_WAREHOUSES.map((w) => (
                        <label key={w} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={fWh.includes(w)}
                            onChange={(e) => setFWh((prev) => (e.target.checked ? [...prev, w] : prev.filter((x) => x !== w)))}
                          />
                          {WAREHOUSE_LABELS[w]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label>
                    <span className="block text-gray-500 mb-1">Yüzde %</span>
                    <input type="number" value={fPercent} onChange={(e) => setFPercent(Number(e.target.value))} className="w-20 border rounded-lg px-2 py-1.5" />
                  </label>
                  <label>
                    <span className="block text-gray-500 mb-1">Sıfırlama eşiği (&lt;X→0)</span>
                    <input type="number" value={fFloor} onChange={(e) => setFFloor(Number(e.target.value))} className="w-24 border rounded-lg px-2 py-1.5" />
                  </label>
                </>
              )}
              <label>
                <span className="block text-gray-500 mb-1">Not</span>
                <input value={fNote} onChange={(e) => setFNote(e.target.value)} className="w-40 border rounded-lg px-2 py-1.5" />
              </label>
              <Button size="sm" icon={<Plus className="w-4 h-4" />} loading={busy === 'config'} onClick={addConfig}>
                Ekle / Güncelle
              </Button>
            </div>

            {configs.length === 0 ? (
              <p className="text-sm text-gray-400">Henüz kural yok — tüm SKU&apos;lar standart {settings?.standardQty ?? 11} alır.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500 border-b">
                  <tr>
                    <th className="py-1.5">iwasku</th>
                    <th>Kova</th>
                    <th>Depolar</th>
                    <th>%</th>
                    <th>Eşik</th>
                    <th>Not</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-1.5 font-mono text-xs">{c.iwasku}</td>
                      <td>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${c.mode === 'STOCK' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>{c.mode}</span>
                      </td>
                      <td className="text-xs">{c.mode === 'STOCK' ? c.warehouses.map((w) => WAREHOUSE_LABELS[w as StockWarehouse] ?? w).join(', ') : '—'}</td>
                      <td>{c.mode === 'STOCK' ? `${c.percent}%` : '—'}</td>
                      <td>{c.mode === 'STOCK' ? c.floorX : '—'}</td>
                      <td className="text-xs text-gray-500">{c.note}</td>
                      <td>
                        <Button variant="ghost" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} loading={busy === `del-${c.id}`} onClick={() => deleteConfig(c.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Önizleme */}
          {preview && (
            <Card padded className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-gray-800">Önizleme</span>
                <span className="text-gray-500">
                  Toplam {preview.counts.total} · STOCK {preview.counts.stock} · standart {preview.counts.standard} · sıfır {preview.counts.zero} ·{' '}
                  <b className="text-blue-600">{preview.changedCount} değişecek</b>
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <select value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(0); }} className="border rounded-lg px-2 py-1 text-xs">
                    <option value="changed">Sadece değişecekler</option>
                    <option value="all">Hepsi</option>
                    <option value="STOCK">STOCK</option>
                    <option value="STANDARD">Standart</option>
                    <option value="ZERO">Sıfır</option>
                  </select>
                  <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="SKU / iwasku ara" className="border rounded-lg px-2 py-1 text-xs w-40" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500 border-b">
                    <tr>
                      <th className="py-1.5">SKU</th>
                      <th>iwasku</th>
                      <th>Kova</th>
                      <th className="text-right">CG-MDN</th>
                      <th className="text-right">CG-Shukran</th>
                      <th className="text-right">Somerset</th>
                      <th className="text-right">Fairfield</th>
                      <th className="text-right">Şu an</th>
                      <th className="text-right">Hedef</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r.marketplaceSku} className={`border-b last:border-0 ${r.willChange ? 'bg-blue-50/40' : ''}`}>
                        <td className="py-1.5 font-mono text-xs">{r.marketplaceSku}</td>
                        <td className="font-mono text-xs text-gray-500">{r.iwasku}</td>
                        <td>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${r.mode === 'STOCK' ? 'bg-blue-100 text-blue-700' : r.mode === 'ZERO' ? 'bg-gray-200 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>{r.mode}</span>
                        </td>
                        <td className="text-right text-xs">{r.breakdown.cgMdn}</td>
                        <td className="text-right text-xs">{r.breakdown.cgShukran}</td>
                        <td className="text-right text-xs">{r.breakdown.nj}</td>
                        <td className="text-right text-xs">{r.breakdown.showroom}</td>
                        <td className="text-right text-gray-500">{r.lastQty ?? '—'}</td>
                        <td className={`text-right font-semibold ${r.willChange ? 'text-blue-600' : 'text-gray-700'}`}>
                          {r.quantity}
                          {r.belowFloor && <span className="ml-1 text-[10px] text-amber-600">(eşik↓)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 text-sm">
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Önceki</Button>
                  <span className="text-gray-500">{page + 1} / {totalPages}</span>
                  <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Sonraki</Button>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
