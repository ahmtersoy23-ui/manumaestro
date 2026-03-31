/**
 * Shipping Settings — Routing Table
 * Maps marketplaces to destination tabs + shipping method + lead time
 * Admin only
 */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Settings, Save, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface Marketplace {
  id: string;
  name: string;
  code: string;
  region: string;
}

interface Route {
  id: string;
  marketplaceId: string;
  destinationTab: string;
  shippingMethod: string;
  leadTimeDays: number | null;
  marketplace: Marketplace;
}

const TABS = ['US', 'UK', 'EU', 'NL', 'AU', 'ZA'];
const METHODS = ['sea', 'road', 'air'];
const methodLabels: Record<string, string> = { sea: '🚢 Deniz', road: '🚛 Karayolu', air: '✈️ Hava' };

export default function ShipmentSettingsPage() {
  const { role } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [routesRes, mpRes] = await Promise.all([
        fetch('/api/shipments/routes'),
        fetch('/api/marketplaces'),
      ]);
      const routesData = await routesRes.json();
      const mpData = await mpRes.json();
      if (routesData.success) setRoutes(routesData.data);
      if (mpData.success) setMarketplaces(mpData.data.filter((m: Marketplace & { isActive: boolean }) => m.isActive));
      setLoading(false);
    }
    load();
  }, []);

  if (role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <AlertCircle className="w-12 h-12 text-red-400" />
      </div>
    );
  }

  const routeMap = new Map(routes.map(r => [r.marketplaceId, r]));

  const handleSave = async (mp: Marketplace, destinationTab: string, shippingMethod: string, leadTimeDays: string) => {
    setSaving(mp.id);
    try {
      await fetch('/api/shipments/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketplaceId: mp.id,
          destinationTab,
          shippingMethod,
          leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : undefined,
        }),
      });
      // Refresh
      const res = await fetch('/api/shipments/routes');
      const data = await res.json();
      if (data.success) setRoutes(data.data);
    } catch {
      alert('Kayıt hatası');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/shipments" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
          <Settings className="w-5 h-5 text-gray-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sevkiyat Routing</h1>
          <p className="text-sm text-gray-500">Pazaryeri → hat eşleştirmesi</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Pazaryeri</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Region</th>
                <th className="text-center px-3 py-3 font-medium text-gray-500">Hat</th>
                <th className="text-center px-3 py-3 font-medium text-gray-500">Yöntem</th>
                <th className="text-center px-3 py-3 font-medium text-gray-500">Lead Time (gün)</th>
                <th className="text-center px-3 py-3 font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {marketplaces.map(mp => {
                const route = routeMap.get(mp.id);
                return (
                  <RouteRow
                    key={mp.id}
                    marketplace={mp}
                    route={route}
                    saving={saving === mp.id}
                    onSave={handleSave}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RouteRow({
  marketplace, route, saving, onSave,
}: {
  marketplace: Marketplace;
  route: Route | undefined;
  saving: boolean;
  onSave: (mp: Marketplace, tab: string, method: string, lead: string) => void;
}) {
  const [tab, setTab] = useState(route?.destinationTab ?? '');
  const [method, setMethod] = useState(route?.shippingMethod ?? 'sea');
  const [lead, setLead] = useState(route?.leadTimeDays?.toString() ?? '');
  const changed = tab !== (route?.destinationTab ?? '') || method !== (route?.shippingMethod ?? 'sea') || lead !== (route?.leadTimeDays?.toString() ?? '');

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 font-medium">{marketplace.name}</td>
      <td className="px-3 py-3 text-gray-500 text-xs">{marketplace.region}</td>
      <td className="px-3 py-3">
        <select value={tab} onChange={e => setTab(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm text-center">
          <option value="">—</option>
          {TABS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-3">
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm text-center">
          {METHODS.map(m => <option key={m} value={m}>{methodLabels[m]}</option>)}
        </select>
      </td>
      <td className="px-3 py-3">
        <input type="number" value={lead} onChange={e => setLead(e.target.value)}
          className="w-20 px-2 py-1 border rounded text-sm text-center mx-auto block" placeholder="—" />
      </td>
      <td className="px-3 py-3 text-center">
        {tab && changed && (
          <button onClick={() => onSave(marketplace, tab, method, lead)} disabled={saving}
            className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
        )}
      </td>
    </tr>
  );
}
