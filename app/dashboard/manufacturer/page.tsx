/**
 * Manufacturer Dashboard Page
 * Consolidated view of all production requests grouped by product
 */

'use client';

import { useState, useEffect } from 'react';
import { ManufacturerTable } from '@/components/tables/ManufacturerTable';
import { Filter, Download, Calendar, X } from 'lucide-react';

interface Stats {
  totalProducts: number;
  totalQuantity: number;
  uniqueCategories: number;
}

export default function ManufacturerPage() {
  const [stats, setStats] = useState<Stats>({
    totalProducts: 0,
    totalQuantity: 0,
    uniqueCategories: 0,
  });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  useEffect(() => {
    // Note: This is an overview page. Actual manufacturer work happens in /manufacturer/[category]
    // Categories will be fetched dynamically in future iterations
    setCategories(['Furniture', 'Lighting', 'Textiles', 'Outdoor']);
  }, []);

  const handleExport = async () => {
    try {
      // Build export URL with filters
      const params = new URLSearchParams();

      if (selectedCategory) {
        params.append('category', selectedCategory);
      }

      // Trigger download
      const url = `/api/export/manufacturer?${params.toString()}`;
      window.location.href = url;
    } catch (error) {
      console.error('Export failed:', error);
      alert('Excel export failed. Please try again.');
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Manufacturer Dashboard</h1>
        <p className="text-gray-600 mt-1">
          Consolidated production requirements from all marketplaces
        </p>
      </div>

      {/* Filters and Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Filter className="w-4 h-4" />
                {selectedCategory || 'Filter by Category'}
              </button>

              {showCategoryDropdown && (
                <div className="absolute z-10 mt-2 w-56 bg-white border border-gray-300 rounded-lg shadow-lg">
                  <div className="p-2">
                    <button
                      onClick={() => {
                        setSelectedCategory(null);
                        setShowCategoryDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                    >
                      All Categories
                    </button>
                    {categories.map((category) => (
                      <button
                        key={category}
                        onClick={() => {
                          setSelectedCategory(category);
                          setShowCategoryDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {selectedCategory && (
              <button
                onClick={() => setSelectedCategory(null)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
              >
                {selectedCategory}
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export to Excel
            </button>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-600 mb-2">Total Products</p>
          <p className="text-3xl font-bold text-gray-900">{stats.totalProducts}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-600 mb-2">Total Quantity</p>
          <p className="text-3xl font-bold text-gray-900">{stats.totalQuantity}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-600 mb-2">Unique Categories</p>
          <p className="text-3xl font-bold text-gray-900">{stats.uniqueCategories}</p>
        </div>
      </div>

      {/* Manufacturer Table */}
      <ManufacturerTable selectedCategory={selectedCategory} />
    </div>
  );
}
