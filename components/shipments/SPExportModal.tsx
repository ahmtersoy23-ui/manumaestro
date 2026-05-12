/**
 * SPExportModal — StockPulse In Transit için TSV (kopyala-yapıştır) modalı.
 *
 * FBA + Depo bölümlerini ayrı textarea olarak gösterir, kopya butonu sağlar.
 * `tsv` string'i parent'ta hesaplanır (boxes useMemo).
 */

import { X, Check, Copy } from 'lucide-react';

export interface SPExportSection {
  count: number;   // SKU count
  total: number;   // toplam adet
  tsv: string;
}

interface Props {
  shipmentName: string;
  fba: SPExportSection;
  depo: SPExportSection;
  copied: 'fba' | 'depo' | null;
  onClose: () => void;
  onCopy: (type: 'fba' | 'depo') => void;
}

export function SPExportModal({ shipmentName, fba, depo, copied, onClose, onCopy }: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">StockPulse Aktarımı</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-5">
          <p className="text-xs text-gray-500">
            Sevkiyat: <span className="font-semibold text-gray-800">{shipmentName}</span> — Koli verilerinden FBA ve Depo olarak ayrıştırıldı.
            StockPulse → In Transit → Yeni Sevkiyat → Yapıştır
          </p>

          {fba.count > 0 && (
            <Section
              badge="FBA-US"
              badgeColor="cyan"
              count={fba.count}
              total={fba.total}
              tsv={fba.tsv}
              copied={copied === 'fba'}
              onCopy={() => onCopy('fba')}
            />
          )}

          {depo.count > 0 && (
            <Section
              badge="NJ"
              badgeColor="amber"
              count={depo.count}
              total={depo.total}
              tsv={depo.tsv}
              copied={copied === 'depo'}
              onCopy={() => onCopy('depo')}
            />
          )}

          {fba.count === 0 && depo.count === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">Koli verisi bulunamadı</p>
          )}
        </div>
        <div className="flex items-center justify-end px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Kapat</button>
        </div>
      </div>
    </div>
  );
}

function Section({
  badge, badgeColor, count, total, tsv, copied, onCopy,
}: {
  badge: string;
  badgeColor: 'cyan' | 'amber';
  count: number;
  total: number;
  tsv: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const badgeClass = badgeColor === 'cyan'
    ? 'bg-cyan-100 text-cyan-800'
    : 'bg-amber-100 text-amber-800';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 ${badgeClass} text-xs font-semibold rounded`}>{badge}</span>
          <span className="text-xs text-gray-500">{count} SKU · {total.toLocaleString('tr-TR')} adet</span>
        </div>
        <button onClick={onCopy}
          className="flex items-center gap-1 px-3 py-1 text-xs border rounded-lg hover:bg-gray-50 transition-colors">
          {copied ? <><Check className="w-3 h-3 text-green-600" /> Kopyalandı</> : <><Copy className="w-3 h-3" /> Kopyala</>}
        </button>
      </div>
      <textarea readOnly value={tsv} rows={Math.min(6, count)}
        className="w-full px-3 py-2 border rounded-lg text-xs font-mono bg-gray-50 resize-none focus:outline-none" />
    </div>
  );
}
