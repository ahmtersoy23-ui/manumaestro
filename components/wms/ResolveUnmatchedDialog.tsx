/**
 * Eşleşmeyen Stok Çözüm Modal — bir UnmatchedSeedRow için iwasku ata.
 * Backend: POST /api/depolar/[code]/unmatched/[id]/resolve
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Search, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ResolveUnmatchedDialog');

interface ProductHit {
  iwasku: string;
  name: string;
  category: string | null;
}

export interface UnmatchedSource {
  id: string;
  rawLookup: string;
  description: string | null;
  shelfCode: string;
  boxNumber: string | null;
  quantity: number;
  groupCount: number; // aynı rawLookup'lı toplam PENDING satır sayısı
  groupTotalQty: number;
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  source: UnmatchedSource | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResolveUnmatchedDialog({ isOpen, warehouseCode, source, onClose, onSuccess }: Props) {
  const [iwasku, setIwasku] = useState('');
  const [productDisplay, setProductDisplay] = useState('');
  const [resolutionType, setResolutionType] = useState<'SKU_MASTER' | 'PRODUCTS'>('SKU_MASTER');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productHits, setProductHits] = useState<ProductHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIwasku('');
      setProductDisplay('');
      setProductHits([]);
      setShowDropdown(false);
      // Group'tan açıldıysa (groupCount > 1) toplu mod default açık
      setApplyToAll((source?.groupCount ?? 1) > 1);
      setError(null);
      // Default: rawLookup'ı arama kutusuna doldur (kullanıcı kolayca arayabilsin)
      setProductSearchQuery(source?.rawLookup ?? '');
    }
  }, [isOpen, source]);

  // Debounced product autocomplete
  useEffect(() => {
    const q = productSearchQuery.trim();
    if (q.length < 2) { setProductHits([]); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) setProductHits(d.data || []);
        })
        .catch((e) => logger.error('Product search', e));
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [productSearchQuery]);

  if (!isOpen || !source) return null;

  const selectProduct = (hit: ProductHit) => {
    setIwasku(hit.iwasku);
    setProductDisplay(`${hit.iwasku} — ${hit.name}`);
    setShowDropdown(false);
    // Default: products üzerinden bulunduysa PRODUCTS, aksi sku_master
    setResolutionType('SKU_MASTER');
  };

  const handleSubmit = async () => {
    setError(null);
    if (!iwasku) return setError('Bir ürün seçin');

    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/unmatched/${source.id}/resolve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iwasku,
          resolutionType,
          applyToAllSameLookup: applyToAll,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Çözme başarısız');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Resolve hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Eşleşmeyen Kaydı Çöz</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Kaynak banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-3 text-sm">
          <div className="text-xs text-amber-700 mb-1">CSV&apos;de kayıtlı</div>
          <div className="font-mono text-xs text-gray-900 break-all">{source.rawLookup}</div>
          {source.description && (
            <div className="text-xs text-gray-700 mt-1">{source.description}</div>
          )}
          <div className="text-xs text-gray-500 mt-2 grid grid-cols-3 gap-1">
            <div>Raf: <span className="font-mono">{source.shelfCode}</span></div>
            <div>{source.boxNumber ? `Koli: ${source.boxNumber}` : 'Tekil ürün'}</div>
            <div className="text-right">Adet: {source.quantity}</div>
          </div>
        </div>

        <div className="space-y-3">
          {/* Ürün autocomplete */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Eşleşecek iwasku — products veya sku_master
            </label>
            {productDisplay ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-blue-200 rounded-md bg-blue-50 text-sm">
                <span className="font-mono text-xs">{iwasku}</span>
                <span className="text-gray-700 truncate flex-1">{productDisplay.split(' — ')[1]}</span>
                <button
                  type="button"
                  onClick={() => { setIwasku(''); setProductDisplay(''); }}
                  className="text-xs text-blue-700 hover:underline"
                >
                  Değiştir
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={productSearchQuery}
                    onChange={(e) => { setProductSearchQuery(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="iwasku veya ürün adı"
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                {showDropdown && productHits.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
                    {productHits.map((p) => (
                      <button
                        key={p.iwasku}
                        type="button"
                        onClick={() => selectProduct(p)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-mono text-xs text-gray-500">{p.iwasku}</div>
                        <div className="text-gray-800 truncate">{p.name}</div>
                        {p.category && <div className="text-[10px] text-gray-400">{p.category}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* applyToAll toggle */}
          {source.groupCount > 1 && (
            <label className="flex items-start gap-2 text-sm cursor-pointer p-2 bg-blue-50 border border-blue-200 rounded">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="rounded mt-0.5"
              />
              <div className="flex-1 text-xs text-gray-700">
                <div className="font-medium">Aynı lookup&apos;lı tüm {source.groupCount} satırı çöz</div>
                <div className="text-gray-500">
                  &quot;{source.rawLookup}&quot; için toplam {source.groupTotalQty} adet bekliyor
                </div>
              </div>
            </label>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              disabled={submitting}
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !iwasku}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Kaydediliyor…' : applyToAll ? `Çöz (${source.groupCount})` : 'Çöz'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
