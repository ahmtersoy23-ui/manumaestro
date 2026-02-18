/**
 * Manufacturer Table Component
 * Shows aggregated production requests by product with marketplace breakdown
 */

'use client';

import { useState, useEffect, Fragment } from 'react';
import { ChevronDown, ChevronRight, Package, Loader2 } from 'lucide-react';

interface ManufacturerTableProps {
  selectedCategory: string | null;
}

interface ProductData {
  iwasku: string;
  productName: string;
  category: string;
  totalQuantity: number;
  breakdown: {
    marketplace: string;
    code: string;
    quantity: number;
  }[];
}

interface RequestItem {
  iwasku: string;
  productName: string;
  productCategory: string;
  quantity: number;
  marketplace: {
    id: string;
    name: string;
    region: string;
    code?: string;
  };
}

function aggregateRequests(requests: RequestItem[]): ProductData[] {
  const productMap = new Map<string, ProductData>();

  for (const req of requests) {
    let product = productMap.get(req.iwasku);
    if (!product) {
      product = {
        iwasku: req.iwasku,
        productName: req.productName,
        category: req.productCategory,
        totalQuantity: 0,
        breakdown: [],
      };
      productMap.set(req.iwasku, product);
    }

    product.totalQuantity += req.quantity;

    const marketplaceCode = req.marketplace.code || req.marketplace.name;
    const existing = product.breakdown.find((b) => b.code === marketplaceCode);
    if (existing) {
      existing.quantity += req.quantity;
    } else {
      product.breakdown.push({
        marketplace: req.marketplace.name,
        code: marketplaceCode,
        quantity: req.quantity,
      });
    }
  }

  return Array.from(productMap.values()).sort((a, b) => b.totalQuantity - a.totalQuantity);
}

export function ManufacturerTable({ selectedCategory }: ManufacturerTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [data, setData] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '200' });
        const res = await fetch(`/api/requests?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();
        const requests: RequestItem[] = json.data || [];

        let aggregated = aggregateRequests(requests);
        if (selectedCategory) {
          aggregated = aggregated.filter((item) => item.category === selectedCategory);
        }
        setData(aggregated);
      } catch {
        setData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [selectedCategory]);

  const toggleRow = (iwasku: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(iwasku)) {
      newExpanded.delete(iwasku);
    } else {
      newExpanded.add(iwasku);
    }
    setExpandedRows(newExpanded);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
          <p className="text-sm text-gray-600">Loading production data...</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Package className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {selectedCategory ? `No products in ${selectedCategory}` : 'No production requests'}
          </h3>
          <p className="text-sm text-gray-600">
            {selectedCategory ? 'Try selecting a different category' : 'Production requests will appear here once you start adding them'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-12">
                {/* Expand column */}
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                IWASKU
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Product Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Category
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Total Quantity
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((item) => {
              const isExpanded = expandedRows.has(item.iwasku);

              return (
                <Fragment key={item.iwasku}>
                  {/* Main Row */}
                  <tr
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => toggleRow(item.iwasku)}
                  >
                    <td className="px-6 py-4">
                      <button className="text-gray-400 hover:text-gray-600">
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5" />
                        ) : (
                          <ChevronRight className="w-5 h-5" />
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-mono text-gray-900">
                        {item.iwasku}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-gray-900">
                        {item.productName}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        {item.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className="text-lg font-bold text-gray-900">
                        {item.totalQuantity}
                      </span>
                    </td>
                  </tr>

                  {/* Expanded Details Row */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-gray-50">
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-gray-700 mb-3">
                            Marketplace Breakdown
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {item.breakdown.map((market) => (
                              <div
                                key={market.code}
                                className="bg-white border border-gray-200 rounded-lg p-3"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-xs font-medium text-gray-600">
                                      {market.marketplace}
                                    </p>
                                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                                      {market.code}
                                    </p>
                                  </div>
                                  <p className="text-lg font-bold text-purple-600">
                                    {market.quantity}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
