/**
 * Konsolidasyon sekmesi — NJ/CG Depo kalemlerini karışık KOLI/PALET'e paketler.
 * FBA tek-SKU "Koliler" tab'ından ayrı. Çıkış tarafı (yerleştirme); varışta
 * stoğa patlatma ayrı faz (Gemi 71 sonrası).
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Boxes, Download, Package, Plus, Printer, Trash2, X } from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ConsolidationTab');

/** EAN-13: 13 hane + doğru kontrol hanesi. Geçersizse barkod basılmaz. */
export function isValidEan13(ean: string | null | undefined): ean is string {
  if (!ean || !/^\d{13}$/.test(ean)) return false;
  const d = ean.split('').map(Number);
  const sum = d.slice(0, 12).reduce((s, n, i) => s + n * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

/**
 * Fairfield depo kalemleri için EAN-13 ürün etiketi (60×40mm, ürün başına `count` kopya).
 * Üstte barkod + okunur EAN numarası, altta ürün adı, en altta iwasku. Tek PDF.
 */
async function printEanLabels(rows: { ean: string; name: string | null; iwasku: string; dest: string; count: number }[]) {
  const printable = rows.filter((r) => r.count > 0 && isValidEan13(r.ean));
  if (printable.length === 0) return;

  const [JsBarcode, { jsPDF }] = await Promise.all([
    import('jsbarcode').then((m) => m.default),
    import('jspdf'),
  ]);

  const PX_PER_MM = 8;
  const W_MM = 60, H_MM = 40;
  const CW = W_MM * PX_PER_MM, CH = H_MM * PX_PER_MM;

  const wrapLine = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
  };

  const doc = new jsPDF({ unit: 'mm', format: [W_MM, H_MM], orientation: 'landscape' });
  let first = true;

  // Barkod yatayda yayılır (X bağımsız uzatma → bar oranları korunur, taranabilir kalır).
  const bcTop = 16, bcW = 440, bcH = 150, bcX = (CW - bcW) / 2;
  for (const r of printable) {
    const bc = document.createElement('canvas');
    JsBarcode(bc, r.ean, { format: 'EAN13', width: 2, height: 80, displayValue: true, fontSize: 22, textMargin: 2, margin: 0 });

    for (let i = 0; i < r.count; i++) {
      if (!first) doc.addPage([W_MM, H_MM], 'landscape');
      first = false;
      const c = document.createElement('canvas');
      c.width = CW; c.height = CH;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = '#000';
      ctx.drawImage(bc, bcX, bcTop, bcW, bcH);
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px Arial';
      let y = bcTop + bcH + 44; // barkod–isim arasını aç
      for (const ln of wrapLine(ctx, r.name ?? r.iwasku, CW - 30).slice(0, 2)) { ctx.fillText(ln, CW / 2, y); y += 24; }
      // Alt köşeler: sol = iwasku, sağ = hedef (Fairfield / CG Depo)
      ctx.font = '15px Courier New'; ctx.fillStyle = '#888';
      ctx.textAlign = 'left';
      ctx.fillText(r.iwasku, 16, CH - 12);
      ctx.textAlign = 'right';
      ctx.fillText(r.dest, CW - 16, CH - 12);
      doc.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, W_MM, H_MM);
    }
  }

  // Tek ürün → dosya adı ürün adı; çoklu (toplu) → jenerik.
  // Dosya adı: boşluklar tarayıcıda %20'ye dönmesin → _; geçersiz karakterleri ayıkla.
  const safe = (s: string) =>
    s.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 120);
  const fileName = printable.length === 1
    ? safe(printable[0].name ?? printable[0].iwasku)
    : `fairfield-ean-etiket-${printable.length}urun`;
  doc.save(`${fileName}.pdf`);
}

const DEST_BADGE: Record<string, string> = {
  NJ_DEPO: 'bg-amber-100 text-amber-700',
  CG_DEPO: 'bg-pink-100 text-pink-700',
};
const DEST_LABEL: Record<string, string> = { NJ_DEPO: 'Fairfield', CG_DEPO: 'CG Depo' };

interface Line { id: string; shipmentItemId: string; iwasku: string; name: string | null; quantity: number }
interface Container {
  id: string; type: string; code: string; labelPrinted: boolean;
  width: number | null; height: number | null; depth: number | null; weight: number | null;
  lines: Line[];
}

const containerDesi = (c: Container): number =>
  (c.width && c.depth && c.height) ? (c.width * c.depth * c.height) / 5000 : 0;
interface Item {
  id: string; iwasku: string; name: string | null; ean: string | null; quantity: number;
  placed: number; remaining: number; labelPrintedAt: string | null;
  recommendedDestination: string | null; marketplaceCode: string | null;
}
interface Data { role: string; canManage: boolean; containers: Container[]; items: Item[] }

export function ConsolidationTab({ shipmentId, shipmentName, onChange }: { shipmentId: string; shipmentName?: string; onChange: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/shipments/${shipmentId}/containers`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.data);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => { logger.error('load', e); setError('Sunucuya bağlanılamadı'); });
  }, [shipmentId]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => { load(); onChange(); }, [load, onChange]);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok || !d.success) { notify.error(d.error || 'İşlem başarısız'); return false; }
      return true;
    } catch (e) {
      logger.error('call', e); notify.error('Sunucu hatası'); return false;
    } finally { setBusy(false); }
  }

  const createContainer = async (type: 'KOLI' | 'PALET') => {
    if (await call(`/api/shipments/${shipmentId}/containers`, 'POST', { type })) refresh();
  };
  const deleteContainer = async (cid: string) => {
    if (await call(`/api/shipments/${shipmentId}/containers/${cid}`, 'DELETE')) refresh();
  };
  const addLine = async (cid: string, shipmentItemId: string, quantity: number) => {
    if (await call(`/api/shipments/${shipmentId}/containers/${cid}/lines`, 'POST', { shipmentItemId, quantity })) refresh();
  };
  const saveDims = async (cid: string, dims: { width?: number | null; height?: number | null; depth?: number | null; weight?: number | null }) => {
    if (await call(`/api/shipments/${shipmentId}/containers/${cid}`, 'PATCH', dims)) refresh();
  };
  const removeLine = async (cid: string, lineId: string) => {
    if (await call(`/api/shipments/${shipmentId}/containers/${cid}/lines?lineId=${lineId}`, 'DELETE')) refresh();
  };

  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-center py-10 text-gray-500 text-sm">Yükleniyor…</div>;

  const canManage = data.canManage;
  const openItems = data.items.filter((i) => i.remaining > 0);
  const totalRemaining = openItems.reduce((s, i) => s + i.remaining, 0);
  const labelItems = openItems.filter((i) => isValidEan13(i.ean));
  const noEanCount = openItems.length - labelItems.length;
  const totalLabels = labelItems.reduce((s, i) => s + i.quantity, 0);
  const destLabel = (d: string | null) => DEST_LABEL[d ?? ''] ?? 'Fairfield';

  // PDF üretimi başarılıysa kalemleri "basıldı" damgala (optimistic + sunucu kalıcı).
  // Tekrar basıma izinli; işaret kaldırılmaz.
  const markPrinted = (itemIds: string[]) => {
    if (itemIds.length === 0) return;
    const ts = new Date().toISOString();
    setData((prev) => prev ? { ...prev, items: prev.items.map((i) => itemIds.includes(i.id) ? { ...i, labelPrintedAt: ts } : i) } : prev);
    fetch(`/api/shipments/${shipmentId}/items/label-printed`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds }),
    }).catch((e) => logger.error('markPrinted', e));
  };

  const printOne = async (it: Item) => {
    await printEanLabels([{ ean: it.ean!, name: it.name, iwasku: it.iwasku, dest: destLabel(it.recommendedDestination), count: it.quantity }]);
    markPrinted([it.id]);
  };
  const printAll = async () => {
    await printEanLabels(labelItems.map((i) => ({ ean: i.ean!, name: i.name, iwasku: i.iwasku, dest: destLabel(i.recommendedDestination), count: i.quantity })));
    markPrinted(labelItems.map((i) => i.id));
  };

  // Excel: tek dosya, 2 sheet (Koli/Palet içerikleri + Depo kalemleri özeti).
  const handleExport = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');

    // Sheet 1 — her satır bir konteyner içi ürün; ölçü/desi konteynerin ilk satırında.
    const containerRows: Record<string, string | number>[] = [];
    for (const c of data.containers) {
      const desi = containerDesi(c);
      if (c.lines.length === 0) {
        containerRows.push({
          'Konteyner': c.code, 'Tip': c.type, 'Ürün': '', 'IWASKU': '', 'Adet': '',
          'En': c.width ?? '', 'Boy': c.depth ?? '', 'Yük.': c.height ?? '', 'Ağr.': c.weight ?? '',
          'Desi': desi ? +desi.toFixed(1) : '',
        });
      } else {
        c.lines.forEach((l, idx) => {
          containerRows.push({
            'Konteyner': c.code, 'Tip': c.type,
            'Ürün': l.name ?? l.iwasku, 'IWASKU': l.iwasku, 'Adet': l.quantity,
            'En': idx === 0 ? (c.width ?? '') : '',
            'Boy': idx === 0 ? (c.depth ?? '') : '',
            'Yük.': idx === 0 ? (c.height ?? '') : '',
            'Ağr.': idx === 0 ? (c.weight ?? '') : '',
            'Desi': idx === 0 ? (desi ? +desi.toFixed(1) : '') : '',
          });
        });
      }
    }

    // Sheet 2 — paketlenmeyi bekleyen/yerleşen tüm depo kalemleri.
    const itemRows = data.items.map((it) => ({
      'Ürün': it.name ?? it.iwasku, 'IWASKU': it.iwasku, 'EAN': it.ean ?? '',
      'Hedef': DEST_LABEL[it.recommendedDestination ?? ''] ?? it.recommendedDestination ?? '',
      'Toplam': it.quantity, 'Yerleşen': it.placed, 'Kalan': it.remaining,
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(containerRows);
    ws1['!cols'] = [{ wch: 12 }, { wch: 7 }, { wch: 40 }, { wch: 16 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 7 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Koli-Palet İçerikleri');
    const ws2 = XLSX.utils.json_to_sheet(itemRows);
    ws2['!cols'] = [{ wch: 40 }, { wch: 16 }, { wch: 15 }, { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 7 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Depo Kalemleri');

    const prefix = shipmentName ? `${shipmentName}-` : '';
    XLSX.writeFile(wb, `${prefix}fairfield-konsolidasyon-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (data.items.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-10 text-sm text-gray-400 text-center">
        Bu sevkiyatta Fairfield / CG Depo hedefli kalem yok — konsolidasyon gerekmez.
      </div>
    );
  }

  const totalContainerDesi = data.containers.reduce((s, c) => s + containerDesi(c), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Boxes className="w-4 h-4 text-indigo-500" /> Fairfield Toplu Gönderim
        </h2>
        <div className="flex items-center gap-3">
          {totalContainerDesi > 0 && (
            <span className="text-xs text-gray-500">
              {data.containers.length} koli/palet · {Math.round(totalContainerDesi).toLocaleString('tr-TR')} desi
            </span>
          )}
          <button onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 border rounded-md">
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Paketlenecek depo kalemleri */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-700 flex items-center gap-2 flex-wrap">
          <Package className="w-4 h-4" /> Paketlenecek Depo Kalemleri
          <span className="text-gray-400">{openItems.length} kalem · {totalRemaining} adet kaldı</span>
          {noEanCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="EAN'i olmayan ürünler etiket basımına dahil edilmez; önce katalogda EAN tamamlanmalı.">
              {noEanCount} ürün EAN&apos;siz
            </span>
          )}
          {totalLabels > 0 && (
            <button onClick={printAll}
              className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded">
              <Printer className="w-3.5 h-3.5" /> Tüm Etiketleri Bas (×{totalLabels})
            </button>
          )}
        </div>
        {openItems.length === 0 ? (
          <div className="px-4 py-6 text-sm text-green-700 text-center">Tüm depo kalemleri yerleştirildi ✓</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] text-gray-500">
              <tr>
                <th className="text-left px-4 py-1.5">Ürün</th>
                <th className="text-left px-4 py-1.5">Hedef</th>
                <th className="text-right px-4 py-1.5">Toplam</th>
                <th className="text-right px-4 py-1.5">Yerleşen</th>
                <th className="text-right px-4 py-1.5">Kalan</th>
                <th className="text-right px-4 py-1.5">Etiket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {openItems.map((it) => (
                <tr key={it.id} className={`text-gray-700 ${it.labelPrintedAt ? 'bg-emerald-50/70' : ''}`}>
                  <td className="px-4 py-1.5">
                    <span>{it.name ?? it.iwasku}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-gray-400">{it.iwasku}</span>
                  </td>
                  <td className="px-4 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${DEST_BADGE[it.recommendedDestination ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                      {DEST_LABEL[it.recommendedDestination ?? ''] ?? it.recommendedDestination}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right">{it.quantity}</td>
                  <td className="px-4 py-1.5 text-right text-gray-400">{it.placed}</td>
                  <td className="px-4 py-1.5 text-right font-semibold text-amber-700">{it.remaining}</td>
                  <td className="px-4 py-1.5 text-right">
                    {isValidEan13(it.ean) ? (
                      <button
                        onClick={() => printOne(it)}
                        title={it.labelPrintedAt
                          ? `Basıldı: ${new Date(it.labelPrintedAt).toLocaleString('tr-TR')} — tekrar basmak için tıkla`
                          : `EAN ${it.ean} — ${it.quantity} adet etiket bas`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded ${
                          it.labelPrintedAt
                            ? 'text-white bg-emerald-600 hover:bg-emerald-700'
                            : 'text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
                        }`}>
                        <Printer className="w-3 h-3" /> {it.labelPrintedAt ? `Basıldı ✓ ×${it.quantity}` : `×${it.quantity}`}
                      </button>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="Bu ürünün geçerli bir EAN'i yok; katalogda tamamlanmalı.">
                        EAN yok
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Container oluştur */}
      {canManage && (
        <div className="flex gap-2">
          <button onClick={() => createContainer('KOLI')} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50">
            <Plus className="w-4 h-4" /> Yeni Koli
          </button>
          <button onClick={() => createContainer('PALET')} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-md disabled:opacity-50">
            <Plus className="w-4 h-4" /> Yeni Palet
          </button>
        </div>
      )}

      {/* Container listesi */}
      {data.containers.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-6">Henüz koli/palet yok.</div>
      ) : (
        data.containers.map((c) => (
          <div key={c.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-800 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-indigo-500" />
                <span className="font-mono">{c.code}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{c.type}</span>
                <span className="text-gray-400 text-xs">{c.lines.length} ürün · {c.lines.reduce((s, l) => s + l.quantity, 0)} adet</span>
              </span>
              <div className="flex items-center gap-3">
                {containerDesi(c) > 0 && (
                  <span className="text-xs text-indigo-600 font-medium">{containerDesi(c).toFixed(1)} desi</span>
                )}
                {canManage && (
                  <button onClick={() => deleteContainer(c.id)} disabled={busy}
                    title="Konteyneri sil" className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            {canManage && (
              <ContainerDims
                key={`${c.id}-${c.width}-${c.depth}-${c.height}-${c.weight}`}
                container={c}
                disabled={busy}
                onSave={(dims) => saveDims(c.id, dims)}
              />
            )}
            {c.lines.length > 0 && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {c.lines.map((l) => (
                    <tr key={l.id} className="text-gray-700">
                      <td className="px-4 py-1.5">
                        <span>{l.name ?? l.iwasku}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-gray-400">{l.iwasku}</span>
                      </td>
                      <td className="px-4 py-1.5 text-right w-20 font-medium">{l.quantity}</td>
                      <td className="px-4 py-1.5 text-right w-10">
                        {canManage && (
                          <button onClick={() => removeLine(c.id, l.id)} disabled={busy}
                            className="text-gray-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canManage && openItems.length > 0 && (
              <AddLineForm items={openItems} disabled={busy} onAdd={(itemId, qty) => addLine(c.id, itemId, qty)} />
            )}
          </div>
        ))
      )}
    </div>
  );
}

function ContainerDims({
  container, disabled, onSave,
}: {
  container: Container;
  disabled: boolean;
  onSave: (dims: { width: number | null; height: number | null; depth: number | null; weight: number | null }) => void;
}) {
  // State props'tan başlatılır; kaydedince parent refresh → key değişir → remount
  // (sync useEffect yerine "key ile uncontrolled" pattern).
  const [w, setW] = useState<number | ''>(container.width ?? '');
  const [d, setD] = useState<number | ''>(container.depth ?? '');
  const [h, setH] = useState<number | ''>(container.height ?? '');
  const [kg, setKg] = useState<number | ''>(container.weight ?? '');

  const num = (v: number | '') => (v === '' ? null : Number(v));
  const save = () => onSave({ width: num(w), depth: num(d), height: num(h), weight: num(kg) });
  const cell = 'w-16 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:border-indigo-400';

  return (
    <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/40 flex items-center gap-2 text-xs text-gray-500">
      <span>Ölçü (cm):</span>
      <input type="number" min={1} value={w} onChange={(e) => setW(e.target.value === '' ? '' : Number(e.target.value))} onBlur={save} disabled={disabled} placeholder="En" className={cell} />
      <span>×</span>
      <input type="number" min={1} value={d} onChange={(e) => setD(e.target.value === '' ? '' : Number(e.target.value))} onBlur={save} disabled={disabled} placeholder="Boy" className={cell} />
      <span>×</span>
      <input type="number" min={1} value={h} onChange={(e) => setH(e.target.value === '' ? '' : Number(e.target.value))} onBlur={save} disabled={disabled} placeholder="Yük" className={cell} />
      <span className="ml-2">Ağırlık (kg):</span>
      <input type="number" min={0} step="0.1" value={kg} onChange={(e) => setKg(e.target.value === '' ? '' : Number(e.target.value))} onBlur={save} disabled={disabled} placeholder="kg" className={cell} />
    </div>
  );
}

function AddLineForm({ items, disabled, onAdd }: { items: Item[]; disabled: boolean; onAdd: (itemId: string, qty: number) => void }) {
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState<number | ''>('');
  const selected = items.find((i) => i.id === itemId);

  return (
    <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50 flex items-center gap-2 flex-wrap">
      <select value={itemId}
        onChange={(e) => { setItemId(e.target.value); const it = items.find((i) => i.id === e.target.value); setQty(it ? it.remaining : ''); }}
        className="flex-1 min-w-[200px] px-2 py-1.5 border border-gray-200 rounded text-sm">
        <option value="">Ürün seç…</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>{(i.name ?? i.iwasku)} — {i.iwasku} (kalan {i.remaining})</option>
        ))}
      </select>
      <input type="number" min={1} max={selected?.remaining} value={qty}
        onChange={(e) => setQty(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
        placeholder="Adet" className="w-20 px-2 py-1.5 border border-gray-200 rounded text-sm text-right" />
      <button
        onClick={() => { if (itemId && typeof qty === 'number' && qty > 0) { onAdd(itemId, qty); setItemId(''); setQty(''); } }}
        disabled={disabled || !itemId || !qty || (typeof qty === 'number' && selected && qty > selected.remaining)}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-40">
        <Plus className="w-3 h-3" /> Ekle
      </button>
    </div>
  );
}
