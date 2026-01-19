/**
 * Marketplace Grid Component
 * Displays marketplace cards in a grid layout
 */

import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';

// Temporary static data - will be replaced with API call
const marketplaces = [
  {
    id: '1',
    name: 'Amazon US',
    code: 'AMZN_US',
    region: 'United States',
    color: 'from-orange-500 to-orange-600',
    textColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    requestCount: 0,
  },
  {
    id: '2',
    name: 'Amazon EU',
    code: 'AMZN_EU',
    region: 'European Union',
    color: 'from-orange-500 to-orange-600',
    textColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    requestCount: 0,
  },
  {
    id: '3',
    name: 'Amazon UK',
    code: 'AMZN_UK',
    region: 'United Kingdom',
    color: 'from-orange-500 to-orange-600',
    textColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    requestCount: 0,
  },
  {
    id: '4',
    name: 'Amazon CA',
    code: 'AMZN_CA',
    region: 'Canada',
    color: 'from-orange-500 to-orange-600',
    textColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    requestCount: 0,
  },
  {
    id: '5',
    name: 'Amazon AU',
    code: 'AMZN_AU',
    region: 'Australia',
    color: 'from-orange-500 to-orange-600',
    textColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    requestCount: 0,
  },
  {
    id: '6',
    name: 'Wayfair US',
    code: 'WAYFAIR_US',
    region: 'United States',
    color: 'from-purple-500 to-purple-600',
    textColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    requestCount: 0,
  },
  {
    id: '7',
    name: 'Wayfair UK',
    code: 'WAYFAIR_UK',
    region: 'United Kingdom',
    color: 'from-purple-500 to-purple-600',
    textColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    requestCount: 0,
  },
  {
    id: '8',
    name: 'Takealot',
    code: 'TAKEALOT_ZA',
    region: 'South Africa',
    color: 'from-blue-500 to-blue-600',
    textColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
    requestCount: 0,
  },
  {
    id: '9',
    name: 'Bol',
    code: 'BOL_NL',
    region: 'Netherlands',
    color: 'from-cyan-500 to-cyan-600',
    textColor: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    requestCount: 0,
  },
];

export function MarketplaceGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Marketplace Cards */}
      {marketplaces.map((marketplace) => (
        <Link
          key={marketplace.id}
          href={`/dashboard/marketplace/${marketplace.code.toLowerCase().replace('_', '-')}`}
          className="group"
        >
          <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg hover:border-gray-300 transition-all">
            {/* Header with gradient */}
            <div className={`bg-gradient-to-r ${marketplace.color} rounded-lg p-4 mb-4`}>
              <h3 className="text-xl font-bold text-white">
                {marketplace.name}
              </h3>
              <p className="text-white/80 text-sm mt-1">{marketplace.region}</p>
            </div>

            {/* Stats */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Active Requests</span>
                <span className={`font-semibold ${marketplace.textColor}`}>
                  {marketplace.requestCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Code</span>
                <span className="text-sm font-mono text-gray-900">
                  {marketplace.code}
                </span>
              </div>
            </div>

            {/* Action Button */}
            <div className="pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between text-sm font-medium group-hover:text-purple-600 transition-colors">
                <span>Enter Requests</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </Link>
      ))}

      {/* Add New Marketplace Card */}
      <Link
        href="/dashboard/settings/marketplaces/new"
        className="group"
      >
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300 p-6 hover:border-purple-400 hover:from-purple-50 hover:to-purple-100 transition-all h-full flex flex-col items-center justify-center min-h-[240px]">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 group-hover:bg-purple-100 transition-colors">
            <Plus className="w-8 h-8 text-gray-400 group-hover:text-purple-600 transition-colors" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 group-hover:text-purple-700 transition-colors">
            Add Marketplace
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Create a custom marketplace
          </p>
        </div>
      </Link>
    </div>
  );
}
