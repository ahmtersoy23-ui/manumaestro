/**
 * Marketplace Entry Page
 * Dynamic page for each marketplace
 * Supports manual entry and Excel bulk upload
 */

import { ManualEntryForm } from '@/components/forms/ManualEntryForm';
import { ExcelUpload } from '@/components/forms/ExcelUpload';
import { RequestsTable } from '@/components/tables/RequestsTable';
import { Download, Upload, PlusCircle } from 'lucide-react';

interface MarketplacePageProps {
  params: Promise<{
    slug: string;
  }>;
}

// Map slugs to marketplace names
const marketplaceNames: Record<string, string> = {
  'amzn-us': 'Amazon US',
  'amzn-eu': 'Amazon EU',
  'amzn-uk': 'Amazon UK',
  'amzn-ca': 'Amazon CA',
  'amzn-au': 'Amazon AU',
  'wayfair-us': 'Wayfair US',
  'wayfair-uk': 'Wayfair UK',
  'takealot': 'Takealot',
  'bol': 'Bol',
};

export default async function MarketplacePage({ params }: MarketplacePageProps) {
  const { slug } = await params;
  const marketplaceName = marketplaceNames[slug] || 'Unknown Marketplace';

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{marketplaceName}</h1>
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
            <button className="py-4 px-2 border-b-2 border-purple-600 text-purple-600 font-medium text-sm flex items-center gap-2">
              <PlusCircle className="w-4 h-4" />
              Manual Entry
            </button>
            <button className="py-4 px-2 border-b-2 border-transparent text-gray-600 hover:text-gray-900 font-medium text-sm flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Excel Upload
            </button>
          </nav>
        </div>

        {/* Manual Entry Form */}
        <div className="p-6">
          <ManualEntryForm marketplaceSlug={slug} />
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
        <RequestsTable marketplaceSlug={slug} />
      </div>
    </div>
  );
}
