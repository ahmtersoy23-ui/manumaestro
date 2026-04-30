/**
 * Add / Edit Marketplace Modal
 * Modal for creating and editing marketplaces
 */

'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MarketplaceModal');

interface MarketplaceData {
  id: string;
  name: string;
  region: string;
}

interface AddMarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editData?: MarketplaceData | null;
}

export function AddMarketplaceModal({ isOpen, onClose, onSuccess, editData }: AddMarketplaceModalProps) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!editData;

  useEffect(() => {
    if (editData) {
      setName(editData.name);
      setRegion(editData.region);
    } else {
      setName('');
      setRegion('');
    }
    setError(null);
  }, [editData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const url = '/api/marketplaces';
      const method = isEditMode ? 'PATCH' : 'POST';
      const body = isEditMode
        ? { id: editData!.id, name, region }
        : { name, region, marketplaceType: 'CUSTOM' };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        setName('');
        setRegion('');
        onSuccess();
        onClose();
      } else {
        setError(data.error || (isEditMode ? 'Pazar yeri güncellenemedi' : 'Pazar yeri oluşturulamadı'));
      }
    } catch (err) {
      setError('Bir hata oluştu');
      logger.error('Marketplace modal error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-marketplace-title"
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 id="add-marketplace-title" className="text-xl font-bold text-gray-900">
            {isEditMode ? 'Pazar Yeri Düzenle' : 'Özel Pazar Yeri Ekle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Pazar Yeri Adı <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ör: Trendyol TR"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="region" className="block text-sm font-medium text-gray-700 mb-1">
              Bölge <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="ör: TR"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={loading || !name || !region}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (isEditMode ? 'Güncelleniyor...' : 'Oluşturuluyor...') : (isEditMode ? 'Güncelle' : 'Oluştur')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
