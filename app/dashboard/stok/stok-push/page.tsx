'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, RefreshCw, Play, Trash2, AlertTriangle, Check } from 'lucide-react';
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
  handlingDays: number | null;
  note: string | null;
}
interface PreviewRow {
  marketplaceSku: string;
  iwasku: string;
  name?: string | null;
  mode: 'STOCK' | 'STANDARD' | 'ZERO';
  quantity: number;
  lastQty: number | null;
  willChange: boolean;
  base?: number;
  belowFloor?: boolean;
  handlingDays?: number | null;
  breakdown: { cgMdn: number; cgShukran: number; nj: number; showroom: number };
}
interface Settings { channel: string; standardQty: number; standardHandlingDays: number | null; enabled: boolean; dryRun: boolean }

const PAGE_SIZE = 100;

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

  // secim + toplu atama
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bMode, setBMode] = useState<'STOCK' | 'ZERO' | 'STANDARD'>('STOCK');
  const [bWh, setBWh] = useState<StockWarehouse[]>([...STOCK_WAREHOUSES]);
  const [bPercent, setBPercent] = useState(100);
  const [bFloor, setBFloor] = useState(0); // alt sınır (<X→0)
  const [bHandling, setBHandling] = useState(''); // handling time (boş=gönderme)

  // filtre
  const [filter, setFilter] = useState<'all' | 'changed' | 'STOCK' | 'ZERO' | 'STANDARD'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showRules, setShowRules] = useState(false);
  // Yetki: admin → Çalıştır/Aktif satırı; canEdit → config işlemleri (pazaryeri ilgilisi).
  const [access, setAccess] = useState<{ isAdmin: boolean; canEdit: boolean }>({ isAdmin: false, canEdit: false });

  const configByIwasku = useMemo(() => new Map(configs.map((c) => [c.iwasku, c])), [configs]);

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
    fetch('/api/stock-push/access', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setAccess({ isAdmin: !!j.isAdmin, canEdit: !!j.canEdit }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPreview(null);
    setMsg(null);
    setSelected(new Set());
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

  const applyBulk = async () => {
    if (selected.size === 0) return;
    setBusy('bulk');
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/stock-push/config/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          channel,
          iwaskus: [...selected],
          mode: bMode === 'STANDARD' ? null : bMode,
          ...(bMode === 'STOCK'
            ? {
                warehouses: bWh,
                percent: bPercent,
                floorX: bFloor,
                ...(ch.supportsHandling && bHandling.trim() !== '' ? { handlingDays: Number(bHandling) } : {}),
              }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(errText(json, 'Atanamadı'));
      setMsg(`${json.count} iwasku → ${bMode === 'STANDARD' ? 'STANDART (kural kaldırıldı)' : bMode}`);
      setSelected(new Set());
      await loadConfigAndSettings();
      await loadPreview();
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
      await loadPreview();
    } finally {
      setBusy(null);
    }
  };

  const runPush = async (dryRun: boolean) => {
    if (!dryRun && !confirm('CANLI push — Amazon listing adetleri değişecek. Emin misin?')) return;
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
      if ((filter === 'STOCK' || filter === 'ZERO' || filter === 'STANDARD') && r.mode !== filter) return false;
      if (q && !r.marketplaceSku.toLowerCase().includes(q) && !r.iwasku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [preview, filter, search]);

  const pageRows = filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);
  const filteredIwaskus = useMemo(() => [...new Set(filteredRows.map((r) => r.iwasku))], [filteredRows]);
  const allFilteredSelected = filteredIwaskus.length > 0 && filteredIwaskus.every((i) => selected.has(i));

  const toggle = (iwasku: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iwasku)) next.delete(iwasku);
      else next.add(iwasku);
      return next;
    });
  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIwaskus.forEach((i) => next.delete(i));
      else filteredIwaskus.forEach((i) => next.add(i));
      return next;
    });

  return (
    <div className="p-4 md:p-6 max-w-[1700px] mx-auto space-y-4">
      <PageHeader icon={<Upload className="w-6 h-6" />} title="Stok Push" subtitle="Pazar yeri listing'lerine otomatik available gönderimi" />

      <div className="flex gap-1 border-b border-gray-200">
        {STOCK_PUSH_CHANNELS.map((c) => (
          <button
            key={c.key}
            onClick={() => c.implemented && setChannel(c.key)}
            disabled={!c.implemented}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              channel === c.key ? 'border-blue-600 text-blue-600' : c.implemented ? 'border-transparent text-gray-500 hover:text-gray-800' : 'border-transparent text-gray-300 cursor-not-allowed'
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
          {(msg || err) && <div className={`text-sm rounded-lg px-3 py-2 ${err ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{err || msg}</div>}

          {/* Üst toolbar: Önizle HERKESE (view); Dry-run/Canlı/Aktif SADECE admin */}
          {settings && (
            <Card padded className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" icon={<RefreshCw className="w-4 h-4" />} loading={loading} onClick={loadPreview}>Önizle</Button>
              {access.isAdmin && (
                <>
                  <Button variant="secondary" size="sm" icon={<Play className="w-4 h-4" />} loading={busy === 'dryrun'} onClick={() => runPush(true)}>Dry-run çalıştır</Button>
                  <Button variant="success" size="sm" icon={<Play className="w-4 h-4" />} loading={busy === 'run'} disabled={!settings.enabled} onClick={() => runPush(false)}>Canlı çalıştır</Button>
                  <div className="ml-auto flex items-center gap-3">
                    {!settings.enabled && (
                      <span className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Pasif → &quot;Canlı çalıştır&quot; yazmaz
                      </span>
                    )}
                    <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={settings.enabled} disabled={busy === 'settings'} onChange={(e) => saveSettings({ enabled: e.target.checked })} /> Aktif (canlı izin)
                    </label>
                  </div>
                </>
              )}
            </Card>
          )}

          {/* SKU listesi + seçim + toplu atama */}
          <Card padded className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-gray-800">SKU listesi</span>
              {preview ? (
                <span className="text-gray-500">
                  Toplam {preview.counts.total} · STOCK {preview.counts.stock} · standart {preview.counts.standard} · sıfır {preview.counts.zero} · <b className="text-blue-600">{preview.changedCount} değişecek</b>
                </span>
              ) : (
                <span className="text-gray-400">Önizle&apos;ye basınca yüklenir</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <select value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(0); }} className="border rounded-lg px-2 py-1 text-xs">
                  <option value="all">Hepsi</option>
                  <option value="changed">Sadece değişecekler</option>
                  <option value="STOCK">STOCK</option>
                  <option value="STANDARD">Standart</option>
                  <option value="ZERO">Sıfır</option>
                </select>
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="SKU / iwasku ara" className="border rounded-lg px-2 py-1 text-xs w-44" />
                {!preview && <Button size="sm" loading={loading} onClick={loadPreview}>Yükle</Button>}
              </div>
            </div>

            {/* Standart adet + kurallar (kuralsız her SKU bu adedi alır) */}
            {settings && (
              <div className="flex flex-wrap items-center gap-3 text-sm border-b pb-3">
                <span className="text-gray-500">Standart adet (kuralsızlara):</span>
                <input
                  type="number"
                  value={settings.standardQty}
                  readOnly={!access.canEdit}
                  onChange={(e) => setSettings({ ...settings, standardQty: Number(e.target.value) })}
                  className="w-20 border rounded-lg px-2 py-1 read-only:bg-gray-100"
                />
                {ch.supportsHandling && (
                  <>
                    <span className="text-gray-500">Handling (gün):</span>
                    <input
                      type="number"
                      value={settings.standardHandlingDays ?? ''}
                      readOnly={!access.canEdit}
                      placeholder="—"
                      onChange={(e) => setSettings({ ...settings, standardHandlingDays: e.target.value === '' ? null : Number(e.target.value) })}
                      className="w-20 border rounded-lg px-2 py-1 read-only:bg-gray-100"
                    />
                  </>
                )}
                {access.canEdit && (
                  <Button variant="secondary" size="sm" loading={busy === 'settings'} onClick={() => saveSettings({ standardQty: settings.standardQty, ...(ch.supportsHandling ? { standardHandlingDays: settings.standardHandlingDays } : {}) })}>Kaydet</Button>
                )}
                <button onClick={() => setShowRules((v) => !v)} className="ml-auto text-gray-600 hover:text-gray-900 font-medium">
                  Kurallar ({configs.length}) {showRules ? '▾' : '▸'}
                </button>
              </div>
            )}
            {showRules && (
              <div className="flex flex-wrap gap-1.5 pb-1">
                {configs.length === 0 ? (
                  <span className="text-xs text-gray-400">Kural yok — tümü standart {settings?.standardQty ?? 11} alır.</span>
                ) : (
                  configs.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-1.5 py-0.5">
                      <span className={c.mode === 'STOCK' ? 'text-blue-700' : 'text-gray-500'}>{c.mode === 'STOCK' ? `${c.percent}%${c.floorX ? `·≥${c.floorX}` : ''}${c.handlingDays != null ? `·${c.handlingDays}g` : ''}` : '0'}</span>
                      <span className="font-mono">{c.iwasku}</span>
                      {access.canEdit && (
                        <button onClick={() => deleteConfig(c.id)} className="text-gray-400 hover:text-red-600" title="kuralı kaldır" disabled={busy === `del-${c.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            )}

            {/* Seçim aksiyon barı — config işlemi (canEdit) */}
            {access.canEdit && selected.size > 0 && (
              <div className="flex flex-wrap items-end gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                <span className="font-semibold text-blue-800 self-center">Seçili {selected.size}</span>
                <label>
                  <span className="block text-gray-500 mb-1 text-xs">Kova</span>
                  <select value={bMode} onChange={(e) => setBMode(e.target.value as typeof bMode)} className="border rounded-lg px-2 py-1.5">
                    <option value="STOCK">STOCK (stok-bazlı)</option>
                    <option value="ZERO">ZERO (→ 0)</option>
                    <option value="STANDARD">Standart (kuralı kaldır)</option>
                  </select>
                </label>
                {bMode === 'STOCK' && (
                  <>
                    <div>
                      <span className="block text-gray-500 mb-1 text-xs">Depolar</span>
                      <div className="flex gap-2">
                        {STOCK_WAREHOUSES.map((w) => (
                          <label key={w} className="flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={bWh.includes(w)} onChange={(e) => setBWh((p) => (e.target.checked ? [...p, w] : p.filter((x) => x !== w)))} />
                            {WAREHOUSE_LABELS[w]}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label>
                      <span className="block text-gray-500 mb-1 text-xs">Yüzde %</span>
                      <input type="number" value={bPercent} onChange={(e) => setBPercent(Number(e.target.value))} className="w-20 border rounded-lg px-2 py-1.5" />
                    </label>
                    <label>
                      <span className="block text-gray-500 mb-1 text-xs">Alt sınır (&lt;X→0)</span>
                      <input type="number" value={bFloor} onChange={(e) => setBFloor(Number(e.target.value))} className="w-24 border rounded-lg px-2 py-1.5" />
                    </label>
                    {ch.supportsHandling && (
                      <label>
                        <span className="block text-gray-500 mb-1 text-xs">Handling (gün)</span>
                        <input type="number" value={bHandling} placeholder="—" onChange={(e) => setBHandling(e.target.value)} className="w-24 border rounded-lg px-2 py-1.5" />
                      </label>
                    )}
                  </>
                )}
                <Button size="sm" icon={<Check className="w-4 h-4" />} loading={busy === 'bulk'} onClick={applyBulk}>Seçili {selected.size}&apos;e uygula</Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Seçimi temizle</Button>
              </div>
            )}

            {preview && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500 border-b">
                    <tr>
                      {access.canEdit && <th className="py-1.5 w-8"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} title="Filtredekilerin tümü" /></th>}
                      <th>SKU</th>
                      <th>iwasku</th>
                      <th>Ad</th>
                      <th>Kova</th>
                      <th className="text-right">CG-MDN</th>
                      <th className="text-right">CG-Shukran</th>
                      <th className="text-right">Somerset</th>
                      <th className="text-right">Fairfield</th>
                      <th className="text-right">Şu an</th>
                      <th className="text-right">Hedef</th>
                      {ch.supportsHandling && <th className="text-right">Handling</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const isSel = selected.has(r.iwasku);
                      const cfg = configByIwasku.get(r.iwasku);
                      return (
                        <tr key={r.marketplaceSku} className={`border-b last:border-0 ${isSel ? 'bg-blue-50' : r.willChange ? 'bg-blue-50/30' : ''}`}>
                          {access.canEdit && <td><input type="checkbox" checked={isSel} onChange={() => toggle(r.iwasku)} /></td>}
                          <td className="py-1.5 font-mono text-xs">{r.marketplaceSku}</td>
                          <td className="font-mono text-xs text-gray-500">{r.iwasku}</td>
                          <td className="text-xs max-w-[240px] truncate" title={r.name ?? ''}>{r.name ?? '—'}</td>
                          <td>
                            <span className={`text-[11px] px-1.5 py-0.5 rounded ${r.mode === 'STOCK' ? 'bg-blue-100 text-blue-700' : r.mode === 'ZERO' ? 'bg-gray-200 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>{r.mode}</span>
                            {cfg?.mode === 'STOCK' && <span className="ml-1 text-[10px] text-gray-400">{cfg.percent}%</span>}
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
                          {ch.supportsHandling && <td className="text-right text-xs text-gray-500">{r.handlingDays != null ? `${r.handlingDays}g` : '—'}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 text-sm">
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Önceki</Button>
                <span className="text-gray-500">{page + 1} / {totalPages} · {filteredRows.length} satır</span>
                <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Sonraki</Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
