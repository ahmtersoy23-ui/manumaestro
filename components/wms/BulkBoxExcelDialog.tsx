/**
 * Excel/CSV ile toplu koli ekleme.
 * 3 adım:
 *   1. Şablon indir / CSV yapıştır veya dosya yükle
 *   2. Önizleme — her satır parse edilmiş, hatalar işaretli
 *   3. Yarat — backend'e POST, sonuç raporu (created + errors)
 *
 * CSV formatı (header satırı zorunlu):
 *   boxNumber,iwasku,quantity,marketplaceCode,destination,targetShelfCode
 *
 * Sadece iwasku/quantity zorunlu; diğerleri boş bırakılabilir.
 * boxNumber boşsa otomatik MAN-{code}-N, marketplaceCode boş bırakılabilir,
 * destination boşsa "DEPO", targetShelfCode boşsa POOL.
 */

'use client';

import { useEffect, useState } from 'react';
import { X, AlertCircle, Upload, Download, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { warehouseLabel } from '@/lib/warehouseLabels';

const logger = createLogger('BulkBoxExcelDialog');

interface ParsedRow {
  index: number; // CSV row index (0-based, header hariç)
  iwasku: string;
  quantity: number | null;
  marketplaceCode: string;
  destination: string;
  boxNumber: string;
  targetShelfCode: string;
  errors: string[];
}

interface BulkResult {
  total: number;
  created: number;
  errorCount: number;
  createdRows: { index: number; iwasku: string; boxNumber: string; shelfCode: string }[];
  errors: { index: number; iwasku: string; message: string }[];
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

const TEMPLATE = 'boxNumber,iwasku,quantity,marketplaceCode,destination,targetShelfCode\n';

export function BulkBoxExcelDialog({ isOpen, warehouseCode, onClose, onSuccess }: Props) {
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setCsvText('');
        setRows([]);
        setResult(null);
        setError(null);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, submitting]);

  const parseCsv = (text: string): ParsedRow[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const header = lines[0].split(/[,;]/).map((h) => h.trim().toLowerCase());
    const headerExpected = ['iwasku', 'quantity'];
    const missing = headerExpected.filter((h) => !header.includes(h));
    if (missing.length > 0) {
      setError(`Header eksik: ${missing.join(', ')}. Şablonu indirip kullan.`);
      return [];
    }
    setError(null);
    const idx = (k: string) => header.indexOf(k);
    const iBn = idx('boxnumber');
    const iIw = idx('iwasku');
    const iQ = idx('quantity');
    const iMp = idx('marketplacecode');
    const iDest = idx('destination');
    const iSh = idx('targetshelfcode');

    return lines.slice(1).map((line, i) => {
      const cols = line.split(/[,;]/).map((c) => c.trim());
      const iwasku = cols[iIw] ?? '';
      const qStr = cols[iQ] ?? '';
      const quantity = qStr ? Number(qStr) : NaN;
      const marketplaceCode = iMp >= 0 ? cols[iMp] || '' : '';
      const destination = (iDest >= 0 ? cols[iDest] : '') || 'DEPO';
      const boxNumber = iBn >= 0 ? cols[iBn] || '' : '';
      const targetShelfCode = iSh >= 0 ? cols[iSh] || '' : '';

      const errors: string[] = [];
      if (!iwasku) errors.push('iwasku zorunlu');
      if (!quantity || !Number.isFinite(quantity) || quantity <= 0)
        errors.push('quantity > 0 olmalı');
      if (destination && !['FBA', 'DEPO', 'SHOWROOM'].includes(destination.toUpperCase()))
        errors.push('destination FBA/DEPO/SHOWROOM olmalı');

      return {
        index: i,
        iwasku,
        quantity: Number.isFinite(quantity) ? quantity : null,
        marketplaceCode,
        destination: destination.toUpperCase(),
        boxNumber,
        targetShelfCode,
        errors,
      };
    });
  };

  const handleParse = (text: string) => {
    setCsvText(text);
    setResult(null);
    setRows(parseCsv(text));
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      handleParse(text);
    };
    reader.onerror = () => setError('Dosya okunamadı');
    reader.readAsText(file, 'utf-8');
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `koli-bulk-sablon-${warehouseCode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validRows = rows.filter((r) => r.errors.length === 0);

  const handleSubmit = async () => {
    setError(null);
    if (validRows.length === 0) {
      setError('Yaratılabilir satır yok.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        rows: validRows.map((r) => ({
          iwasku: r.iwasku,
          quantity: r.quantity!,
          marketplaceCode: r.marketplaceCode || undefined,
          destination: r.destination as 'FBA' | 'DEPO' | 'SHOWROOM',
          boxNumber: r.boxNumber || undefined,
          targetShelfCode: r.targetShelfCode || undefined,
        })),
      };
      const res = await fetch(`/api/depolar/${warehouseCode}/koli/bulk`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Toplu yaratma başarısız');
        return;
      }
      setResult(data.data);
      if (data.data.created > 0) onSuccess();
    } catch (e) {
      logger.error('Bulk submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col text-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Toplu Koli (Excel/CSV) — {warehouseLabel(warehouseCode)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Kapat"
            className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!result && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900 space-y-1">
                <p className="font-semibold">CSV formatı:</p>
                <p className="font-mono">
                  boxNumber,iwasku,quantity,marketplaceCode,destination,targetShelfCode
                </p>
                <p>
                  Sadece <b>iwasku, quantity</b> zorunlu. Boşsa: boxNumber=otomatik
                  MAN-{`{depo}`}-N, marketplaceCode=boş, destination=DEPO, targetShelfCode=POOL.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  <Download className="w-4 h-4" /> Şablon İndir
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50 cursor-pointer">
                  <Upload className="w-4 h-4" /> CSV Dosyası Yükle
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  …veya CSV içeriğini yapıştır:
                </label>
                <textarea
                  value={csvText}
                  onChange={(e) => handleParse(e.target.value)}
                  rows={6}
                  placeholder="boxNumber,iwasku,quantity,marketplaceCode,destination,targetShelfCode&#10;,IWA001,10,,,&#10;BOX-A1,IWA002,5,,,FF-HAVUZ"
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-xs font-mono focus:outline-none focus:border-blue-400"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" /> {error}
                </div>
              )}

              {rows.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">
                      Önizleme: {rows.length} satır
                      {rows.length !== validRows.length && (
                        <span className="ml-2 text-red-700">
                          ({rows.length - validRows.length} hatalı)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase">
                        <tr>
                          <th className="text-left px-2 py-1.5">#</th>
                          <th className="text-left px-2 py-1.5">Koli no</th>
                          <th className="text-left px-2 py-1.5">iwasku</th>
                          <th className="text-right px-2 py-1.5">qty</th>
                          <th className="text-left px-2 py-1.5">MP</th>
                          <th className="text-left px-2 py-1.5">Hedef</th>
                          <th className="text-left px-2 py-1.5">Raf</th>
                          <th className="text-left px-2 py-1.5">Hata</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.map((r) => (
                          <tr
                            key={r.index}
                            className={r.errors.length > 0 ? 'bg-red-50/30' : 'text-gray-700'}
                          >
                            <td className="px-2 py-1 text-gray-400">{r.index + 1}</td>
                            <td className="px-2 py-1 font-mono text-gray-500">
                              {r.boxNumber || 'oto'}
                            </td>
                            <td className="px-2 py-1 font-mono">{r.iwasku || '—'}</td>
                            <td className="px-2 py-1 text-right">{r.quantity ?? '—'}</td>
                            <td className="px-2 py-1 font-mono text-gray-500">
                              {r.marketplaceCode || '—'}
                            </td>
                            <td className="px-2 py-1">{r.destination}</td>
                            <td className="px-2 py-1 font-mono text-gray-500">
                              {r.targetShelfCode || 'POOL'}
                            </td>
                            <td className="px-2 py-1 text-red-700">
                              {r.errors.join('; ') || ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <div>
                  <p className="font-semibold">{result.created} koli yaratıldı</p>
                  {result.errorCount > 0 && (
                    <p className="text-xs text-amber-800">{result.errorCount} satır hata aldı</p>
                  )}
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-xs font-semibold text-red-900">
                    Hatalı satırlar
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-red-100">
                        {result.errors.map((err) => (
                          <tr key={err.index}>
                            <td className="px-2 py-1 text-gray-500 w-12">#{err.index + 1}</td>
                            <td className="px-2 py-1 font-mono">{err.iwasku}</td>
                            <td className="px-2 py-1 text-red-700">{err.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
          >
            {result ? 'Kapat' : 'İptal'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || validRows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {submitting ? 'Yaratılıyor…' : `Yarat (${validRows.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
