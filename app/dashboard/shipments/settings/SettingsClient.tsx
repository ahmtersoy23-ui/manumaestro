/**
 * Shipping Settings Client — routing table edit + save.
 *
 * Server Component routes + marketplaces'i prop olarak veriyor. Save sonrası
 * router.refresh() ile fresh data prop olarak geliyor — manuel fetch yok.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Loader2 } from 'lucide-react';
import { notify } from '@/lib/ui/notify';

export interface MarketplaceDTO {
  id: string;
  name: string;
  code: string;
  region: string;
}

export interface RouteDTO {
  id: string;
  marketplaceId: string;
  destinationTab: string;
  shippingMethod: string;
  leadTimeDays: number | null;
  marketplace: MarketplaceDTO;
}

const TABS = ['US', 'UK', 'EU', 'NL', 'AU', 'ZA'];
const METHODS = ['sea', 'road', 'air'];
const methodLabels: Record<string, string> = { sea: '🚢 Deniz', road: '🚛 Karayolu', air: '✈️ Hava' };

interface Props {
  initialRoutes: RouteDTO[];
  marketplaces: MarketplaceDTO[];
}

export function SettingsClient({ initialRoutes, marketplaces }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const routeMap = new Map(initialRoutes.map(r => [r.marketplaceId, r]));

  const handleSave = async (
    mp: MarketplaceDTO,
    destinationTab: string,
    shippingMethod: string,
    leadTimeDays: string,
  ) => {
    setSaving(mp.id);
    try {
      const res = await fetch('/api/shipments/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketplaceId: mp.id,
          destinationTab,
          shippingMethod,
          leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        notify.error(data.error || 'Kayıt hatası');
        return;
      }
      router.refresh();
    } catch {
      notify.error('Kayıt hatası');
    } finally {
      setSaving(null);
    }
  };

  return (
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
  );
}

function RouteRow({
  marketplace, route, saving, onSave,
}: {
  marketplace: MarketplaceDTO;
  route: RouteDTO | undefined;
  saving: boolean;
  onSave: (mp: MarketplaceDTO, tab: string, method: string, lead: string) => void;
}) {
  const [tab, setTab] = useState(route?.destinationTab ?? '');
  const [method, setMethod] = useState(route?.shippingMethod ?? 'sea');
  const [lead, setLead] = useState(route?.leadTimeDays?.toString() ?? '');
  const changed = tab !== (route?.destinationTab ?? '')
    || method !== (route?.shippingMethod ?? 'sea')
    || lead !== (route?.leadTimeDays?.toString() ?? '');

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 font-medium text-gray-900">{marketplace.name}</td>
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
