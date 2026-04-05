/**
 * Shipments Dashboard
 * Tab-based view by destination (US, UK, EU, NL, AU, ZA)
 * Açık ve kapalı sevkiyatlar
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  Ship, Plus, Settings, AlertCircle, Loader2,
  Anchor, Truck as TruckIcon, Plane, ChevronDown, Calendar,
} from 'lucide-react';

interface ShipmentStats {
  itemCount: number;
  totalQty: number;
  totalDesi: number;
}

interface Shipment {
  id: string;
  name: string;
  destinationTab: string;
  shippingMethod: string;
  plannedDate: string;
  actualDate: string | null;
  status: string;
  notes: string | null;
  stats: ShipmentStats;
}

const TABS = ['US', 'UK', 'EU', 'NL', 'AU', 'ZA'] as const;
type Tab = typeof TABS[number];

const tabLabels: Record<Tab, string> = {
  US: '🇺🇸 US', UK: '🇬🇧 UK', EU: '🇪🇺 EU', NL: '🇳🇱 NL', AU: '🇦🇺 AU', ZA: '🇿🇦 ZA',
};

const methodIcons: Record<string, typeof Anchor> = {
  sea: Anchor, road: TruckIcon, air: Plane,
};
const methodLabels: Record<string, string> = { sea: 'Deniz', road: 'Kara', air: 'Hava' };

export default function ShipmentsPage() {
  useAuth(); // Session check
  const [activeTab, setActiveTab] = useState<Tab>('US');
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', shippingMethod: 'sea', plannedDate: '', notes: '' });
  const [canCreate, setCanCreate] = useState(false);

  const fetchShipments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/shipments?destinationTab=${activeTab}`);
      const data = await res.json();
      if (data.success) { setShipments(data.data); setCanCreate(data.permissions?.canCreate ?? false); }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [activeTab]);

  useEffect(() => { fetchShipments(); }, [fetchShipments]);


  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, destinationTab: activeTab,
          shippingMethod: form.shippingMethod,
          plannedDate: form.plannedDate ? new Date(form.plannedDate).toISOString() : undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        setForm({ name: '', shippingMethod: 'sea', plannedDate: '', notes: '' });
        fetchShipments();
      } else { alert(data.error); }
    } catch { alert('Baglanti hatasi'); } finally { setCreating(false); }
  };

  const openShipments = shipments.filter(s => s.status === 'PLANNING' || s.status === 'LOADING');
  const closedShipments = shipments.filter(s => s.status === 'IN_TRANSIT' || s.status === 'DELIVERED');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <Ship className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sevkiyat</h1>
            <p className="text-sm text-gray-500">Gemi ve TIR yonetimi</p>
          </div>
        </div>
        <Link href="/dashboard/shipments/settings"
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
          <Settings className="w-4 h-4" /> Routing Ayarlari
        </Link>
      </div>

      {/* Destination Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {/* Create Shipment */}
      {canCreate && (
      <div className="flex gap-2">
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Yeni Sevkiyat ({activeTab})
        </button>
      </div>
      )}

      {showCreate && canCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-blue-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Yeni Sevkiyat — {tabLabels[activeTab]}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Isim</label>
              <input type="text" required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={`Gemi 70`}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Yontem</label>
              <select value={form.shippingMethod} onChange={e => setForm(f => ({ ...f, shippingMethod: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="sea">Deniz</option>
                <option value="road">Karayolu</option>
                <option value="air">Hava</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Planlanan Tarih</label>
              <input type="date" value={form.plannedDate}
                onChange={e => setForm(f => ({ ...f, plannedDate: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Not</label>
              <input type="text" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {creating && <Loader2 className="w-4 h-4 animate-spin" />} Olustur
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">Iptal</button>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>}

      {/* Open Shipments */}
      {!loading && openShipments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Acik Sevkiyatlar</h2>
          {openShipments.map(s => <ShipmentCard key={s.id} shipment={s} />)}
        </div>
      )}

      {/* Closed Shipments */}
      {!loading && closedShipments.length > 0 && (
        <details className="group">
          <summary className="text-sm font-semibold text-gray-500 uppercase tracking-wider cursor-pointer flex items-center gap-1">
            Kapali Sevkiyatlar ({closedShipments.length})
            <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="mt-3 space-y-3">
            {closedShipments.map(s => <ShipmentCard key={s.id} shipment={s} />)}
          </div>
        </details>
      )}

      {/* Empty */}
      {!loading && shipments.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border">
          <Ship className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{tabLabels[activeTab]} hattinda sevkiyat yok</h3>
          <p className="text-gray-500 text-sm">Yeni sevkiyat olusturarak baslayin.</p>
        </div>
      )}
    </div>
  );
}

function ShipmentCard({ shipment }: { shipment: Shipment }) {
  const MethodIcon = methodIcons[shipment.shippingMethod] ?? Anchor;
  const label = methodLabels[shipment.shippingMethod] ?? '';
  const date = shipment.plannedDate ? new Date(shipment.plannedDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <Link href={`/dashboard/shipments/${shipment.id}`}
      className="block bg-white border rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all">
      <div className="flex items-center gap-3">
        <MethodIcon className="w-5 h-5 text-gray-400" />
        <div>
          <h3 className="font-semibold text-gray-900">{shipment.name}</h3>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
            <span>{label}</span>
            {date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{date}</span>}
            <span>{shipment.stats.itemCount} urun</span>
            <span>{shipment.stats.totalQty.toLocaleString('tr-TR')} unite</span>
            <span>{shipment.stats.totalDesi.toLocaleString('tr-TR')} desi</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
