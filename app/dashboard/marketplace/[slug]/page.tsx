/**
 * Marketplace Entry Page
 * Dynamic page for each marketplace
 * Supports manual entry and Excel bulk upload
 */

'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ManualEntryForm } from '@/components/forms/ManualEntryForm';
import { ExcelUpload } from '@/components/forms/ExcelUpload';
import { RequestsTable } from '@/components/tables/RequestsTable';
import { Download, Upload, PlusCircle, Clock, Archive, ArrowLeft } from 'lucide-react';
import { parseMonthValue, getActiveMonths } from '@/lib/monthUtils';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MarketplacePage');

interface Marketplace {
  id: string;
  name: string;
  code: string;
}

export default function MarketplacePage({ params }: { params: Promise<{ slug: string }> }) {
  const searchParams = useSearchParams();
  const month = searchParams.get('month');

  const [marketplace, setMarketplace] = useState<Marketplace | null>(null);
  const [activeTab, setActiveTab] = useState<'manual' | 'excel'>('manual');
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState<string>('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [exporting, setExporting] = useState(false);

  // Month tabs - get active months
  const [availableMonths, setAvailableMonths] = useState<Array<{ value: string; label: string; locked: boolean }>>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  // Initialize selected month from URL or current month
  useEffect(() => {
    const activeMonths = getActiveMonths();
    setAvailableMonths(activeMonths);

    // Set selected month from URL or use current month
    if (month) {
      setSelectedMonth(month);
    } else {
      setSelectedMonth(activeMonths[0]?.value || '');
    }
  }, [month]);

  // Parse month label
  const getMonthLabel = (monthValue: string) => {
    try {
      const date = parseMonthValue(monthValue);
      return date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    } catch {
      return monthValue;
    }
  };

  useEffect(() => {
    // Unwrap params Promise
    params.then((p) => setSlug(p.slug));
  }, [params]);

  useEffect(() => {
    if (!slug) return;

    // Fetch marketplace data based on slug
    async function fetchMarketplace() {
      try {
        const res = await fetch('/api/marketplaces', {
          cache: 'no-store',
        });
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

          // Convert slug to code (e.g., custom-01 -> CUSTOM_01)
          const code = slugToCode[slug] || slug.toUpperCase().replace('-', '_');
          const found = data.data.find((m: Marketplace) => m.code === code);
          setMarketplace(found || null);
        }
      } catch (error) {
        logger.error('Failed to fetch marketplace:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchMarketplace();
  }, [slug]);

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
          <p className="text-xs text-gray-400 mt-4">Slug: {slug}</p>
        </div>
      </div>
    );
  }

  const handleExport = async () => {
    setExporting(true);
    try {
      const archiveParam = selectedMonth === 'archive' ? '&archiveMode=true' : '';
      const monthParam = selectedMonth !== 'archive' ? `&month=${selectedMonth}` : '';
      const res = await fetch(`/api/requests?marketplaceId=${marketplace.id}&limit=1000${archiveParam}${monthParam}`);
      const data = await res.json();

      if (!data.success || !data.data.length) {
        alert('No data to export');
        return;
      }

      // Convert to CSV
      const headers = ['Date', 'IWASKU', 'Product Name', 'Category', 'Quantity', 'Production Month', 'Status', 'Notes'];
      const csvRows = [headers.join(',')];

      data.data.forEach((request: any) => {
        const row = [
          new Date(request.requestDate).toLocaleDateString('tr-TR'),
          request.iwasku,
          `"${request.productName.replace(/"/g, '""')}"`,
          request.productCategory,
          request.quantity,
          request.productionMonth,
          request.status,
          request.notes ? `"${request.notes.replace(/"/g, '""')}"` : '',
        ];
        csvRows.push(row.join(','));
      });

      // Download CSV with UTF-8 BOM for proper Turkish character support
      const BOM = '\uFEFF';
      const csvContent = BOM + csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const filename = `${marketplace.name.replace(/\s+/g, '_')}_${selectedMonth === 'archive' ? 'archive' : selectedMonth}_${new Date().toISOString().split('T')[0]}.csv`;

      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      logger.error('Export error:', error);
      alert('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Back Button */}
      {month && (
        <Link
          href={`/dashboard/month/${month}`}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {getMonthLabel(month)}
        </Link>
      )}

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
            <ManualEntryForm
              marketplaceId={marketplace.id}
              marketplaceName={marketplace.name}
              onSuccess={() => setRefreshTrigger(prev => prev + 1)}
            />
          ) : (
            <ExcelUpload marketplaceId={marketplace.id} marketplaceName={marketplace.name} />
          )}
        </div>
      </div>

      {/* Requests - Month Tabs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {availableMonths.map((month) => (
              <button
                key={month.value}
                onClick={() => setSelectedMonth(month.value)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  selectedMonth === month.value
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {month.label}
              </button>
            ))}
            <button
              onClick={() => setSelectedMonth('archive')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                selectedMonth === 'archive'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Archive className="w-4 h-4" />
              Archive
            </button>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
        <RequestsTable
          marketplaceId={marketplace.id}
          month={selectedMonth !== 'archive' ? selectedMonth : undefined}
          refreshTrigger={refreshTrigger}
          onDelete={() => setRefreshTrigger(prev => prev + 1)}
          archiveMode={selectedMonth === 'archive'}
        />
      </div>
    </div>
  );
}
