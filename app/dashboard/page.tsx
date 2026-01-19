/**
 * Dashboard Home Page
 * Main dashboard with marketplace cards
 */

import { MarketplaceGrid } from '@/components/ui/MarketplaceGrid';
import { StatsCards } from '@/components/ui/StatsCards';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">
          Select a marketplace to enter production requests
        </p>
      </div>

      {/* Stats Overview */}
      <StatsCards />

      {/* Marketplace Grid */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Marketplaces
        </h2>
        <MarketplaceGrid />
      </div>
    </div>
  );
}
