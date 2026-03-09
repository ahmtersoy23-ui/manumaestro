/**
 * Product Marketplace Modal
 * Shows marketplace breakdown for a specific product (IWASKU)
 */

'use client';

import { X, ShoppingBag } from 'lucide-react';

const PRIORITY_STYLE: Record<string, string> = {
  HIGH: 'bg-red-100 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
  LOW: 'bg-blue-100 text-blue-700 border-blue-200',
};

const PRIORITY_LABEL: Record<string, string> = {
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
};

interface MarketplaceRequest {
  marketplaceName: string;
  quantity: number;
  colorTag?: string | null;
  priority?: string;
}

interface ProductMarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  iwasku: string;
  productName: string;
  requests: MarketplaceRequest[];
}

export function ProductMarketplaceModal({
  isOpen,
  onClose,
  iwasku,
  productName,
  requests,
}: ProductMarketplaceModalProps) {
  if (!isOpen) return null;

  const total = requests.reduce((sum, r) => sum + r.quantity, 0);
  const sorted = [...requests].sort((a, b) => b.quantity - a.quantity);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <ShoppingBag className="w-5 h-5 text-purple-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Pazar Yeri Dağılımı</h2>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{iwasku}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Product Name */}
        <div className="px-6 pt-4 pb-2">
          <p className="text-sm text-gray-700 font-medium">{productName}</p>
        </div>

        {/* Marketplace List */}
        <div className="px-6 pb-2 space-y-3">
          {sorted.map((req, i) => {
            const pct = total > 0 ? Math.round((req.quantity / total) * 100) : 0;
            return (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {req.colorTag && (
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: req.colorTag }}
                      />
                    )}
                    <span className="text-sm text-gray-900">{req.marketplaceName}</span>
                    {req.priority && (
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[req.priority]}`}>
                        {PRIORITY_LABEL[req.priority]}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-900">{req.quantity}</span>
                    <span className="text-gray-400 w-10 text-right">{pct}%</span>
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-purple-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Total */}
        <div className="mx-6 my-4 pt-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Toplam</span>
          <span className="text-sm font-bold text-gray-900">{total} adet</span>
        </div>
      </div>
    </div>
  );
}
