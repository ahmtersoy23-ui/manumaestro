/**
 * Stats Cards Component
 * Overview statistics for the dashboard
 */

import { Package, TrendingUp, Clock, CheckCircle } from 'lucide-react';

const stats = [
  {
    label: 'Total Requests',
    value: '0',
    icon: Package,
    color: 'bg-blue-500',
    change: '+0%',
  },
  {
    label: 'In Production',
    value: '0',
    icon: Clock,
    color: 'bg-orange-500',
    change: '+0%',
  },
  {
    label: 'Completed',
    value: '0',
    icon: CheckCircle,
    color: 'bg-green-500',
    change: '+0%',
  },
  {
    label: 'This Month',
    value: '0',
    icon: TrendingUp,
    color: 'bg-purple-500',
    change: '+0%',
  },
];

export function StatsCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stat.value}
                </p>
                <p className="text-sm text-green-600 mt-2">{stat.change}</p>
              </div>
              <div className={`${stat.color} p-3 rounded-lg`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
