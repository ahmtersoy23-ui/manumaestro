/**
 * Marketplace Entry Page
 * Dynamic page for each marketplace
 * Supports manual entry and Excel bulk upload
 */

'use client';

import { useState, useEffect } from 'react';
import { ManualEntryForm } from '@/components/forms/ManualEntryForm';
import { ExcelUpload } from '@/components/forms/ExcelUpload';
import { RequestsTable } from '@/components/tables/RequestsTable';
import { Download, Upload, PlusCircle } from 'lucide-react';

interface Marketplace {
  id: string;
  name: string;
  code: string;
}

export default function MarketplacePage({ params }: { params: { slug: string } }) {
  const [marketplace, setMarketplace] = useState<Marketplace | null>(null);
  const [activeTab, setActiveTab] = useState<'manual' | 'excel'>('manual');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch marketplace data based on slug
    async function fetchMarketplace() {
      try {
        const res = await fetch('/api/marketplaces');
        const data = await res.json();

        if (data.success) {
          // Find marketplace by converting slug to code format
          const slugToCode: Record<string, string> = {
            'amzn-us': 'AMZN_US',
            'amzn-eu': 'AMZN_EU',
            'amzn-uk': 'AMZN_UK',
            'amzn-ca': 'AMZN_CA',
            'amzn-au': 'AMZN_AU',
            'wayfair-us': 'WAYFAIR_US',
            'wayfair-uk': 'WAYFAIR_UK',
            'takealot-za': 'TAKEALOT_ZA',
            'bol-nl': 'BOL_NL',
          };

          const code = slugToCode[params.slug];
          const found = data.data.find((m: Marketplace) => m.code === code);
          setMarketplace(found || null);
        }
      } catch (error) {
        console.error('Failed to fetch marketplace:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchMarketplace();
  }, [params.slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!marketplace) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Marketplace Not Found</h1>
          <p className="text-gray-600">The requested marketplace could not be found.</p>
          <p className="text-xs text-gray-400 mt-4">Slug: {params.slug}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{marketplace.name}</h1>
            <p className="text-gray-600 mt-1">
              Enter production requests manually or upload via Excel
            </p>
          </div>
        </div>
      </div>

      {/* Entry Methods - Tabs */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex gap-4 px-6" aria-label="Entry methods">
            <button
              onClick={() => setActiveTab('manual')}
              className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                activeTab === 'manual'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              Manual Entry
            </button>
            <button
              onClick={() => setActiveTab('excel')}
              className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                activeTab === 'excel'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Upload className="w-4 h-4" />
              Excel Upload
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'manual' ? (
            <ManualEntryForm marketplaceId={marketplace.id} marketplaceName={marketplace.name} />
          ) : (
            <ExcelUpload marketplaceId={marketplace.id} marketplaceName={marketplace.name} />
          )}
        </div>
      </div>

      {/* Recent Requests */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Recent Requests
          </h2>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
        <RequestsTable marketplaceId={marketplace.id} />
      </div>
    </div>
  );
}
