/**
 * Shipments Client — 2-seviyeli tab (üst ülke + alt destinasyon).
 *
 * Üst tab: US/UK/EU/CA/AU/ZA (ülke).
 * Alt tab: ülke için destinasyon listesi (örn. US altında US FBA / NJ Depo /
 *   CG Depo). Aktif destinasyon URL ?tab=... ile saklanır, RSC fresh fetch.
 *
 * shipments.destinationTab artık destinasyon kodu (US_FBA, NJ_DEPO, vs.);
 * yetki kontrolü ülke-bazlı (shipmentPermission.destinationToPermissionTab).
 */

'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ship, Plus, Settings, Loader2,
  Anchor, Truck as TruckIcon, Plane, ChevronDown, Calendar,
} from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import {
  SHIPMENT_COUNTRIES, SHIPMENT_COUNTRY_LABELS,
  SHIPMENT_DESTINATIONS_BY_COUNTRY,
  SHIPMENT_DESTINATION_LABELS, SHIPMENT_DESTINATION_STYLES,
  countryForShipmentDestination,
  type ShipmentCountry,
} from '@/lib/marketplaceRegions';

export interface ShipmentStats {
  itemCount: number;
  totalQty: number;
  totalDesi: number;
}

export interface ShipmentDTO {
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

const methodIcons: Record<string, typeof Anchor> = {
  sea: Anchor, road: TruckIcon, air: Plane,
};
const methodLabels: Record<string, string> = { sea: 'Deniz', road: 'Kara', air: 'Hava' };

interface Props {
  activeDestination: string; // örn. 'US_FBA' / 'NJ_DEPO' / 'EU_FBA'
  initialShipments: ShipmentDTO[];
  canCreate: boolean;
}

export function ShipmentsClient({ activeDestination, initialShipments, canCreate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', shippingMethod: 'sea', plannedDate: '', notes: '' });

  const activeCountry = useMemo<ShipmentCountry>(
    () => countryForShipmentDestination(activeDestination) ?? 'US',
    [activeDestination],
  );
  const altDestinations = SHIPMENT_DESTINATIONS_BY_COUNTRY[activeCountry];
  const showAltTabs = altDestinations.length > 1; // CA/AU/ZA tek destinasyon → alt tab gizle

  const switchTo = (destination: string) => {
    startTransition(() => router.replace(`/dashboard/shipments?tab=${destination}`));
  };

  const switchCountry = (country: ShipmentCountry) => {
    // Ülke değişince o ülkenin ilk destinasyonuna geç
    const firstDest = SHIPMENT_DESTINATIONS_BY_COUNTRY[country][0];
    switchTo(firstDest);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, destinationTab: activeDestination,
          shippingMethod: form.shippingMethod,
          plannedDate: form.plannedDate ? new Date(form.plannedDate).toISOString() : undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        setForm({ name: '', shippingMethod: 'sea', plannedDate: '', notes: '' });
        router.refresh();
      } else { notify.error(data.error); }
    } catch { notify.error('Bağlantı hatası'); } finally { setCreating(false); }
  };

  const openShipments = initialShipments.filter(s => s.status === 'PLANNING' || s.status === 'LOADING');
  const closedShipments = initialShipments.filter(s => s.status === 'IN_TRANSIT' || s.status === 'DELIVERED');

  const destLabel = SHIPMENT_DESTINATION_LABELS[activeDestination] ?? activeDestination;
  const destStyle = SHIPMENT_DESTINATION_STYLES[activeDestination]
    ?? { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };

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
            <p className="text-sm text-gray-500">Gemi ve TIR yönetimi</p>
          </div>
        </div>
        <Link href="/dashboard/shipments/settings"
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
          <Settings className="w-4 h-4" /> Routing Ayarları
        </Link>
      </div>

      {/* Country Tabs (üst seviye) */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
        {SHIPMENT_COUNTRIES.map(country => (
          <button key={country} onClick={() => switchCountry(country)} disabled={isPending}
            className={`px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors disabled:opacity-60 ${
              activeCountry === country ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {SHIPMENT_COUNTRY_LABELS[country]}
          </button>
        ))}
      </div>

      {/* Destination Sub-Tabs (alt seviye, sadece çoklu destinasyon varsa) */}
      {showAltTabs && (
        <div className="flex gap-1 flex-wrap">
          {altDestinations.map(dest => {
            const style = SHIPMENT_DESTINATION_STYLES[dest] ?? { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
            const active = activeDestination === dest;
            return (
              <button key={dest} onClick={() => switchTo(dest)} disabled={isPending}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-60 ${
                  active
                    ? `${style.bg} ${style.text} ${style.border} ring-2 ring-offset-1 ring-current`
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {SHIPMENT_DESTINATION_LABELS[dest] ?? dest}
              </button>
            );
          })}
        </div>
      )}

      {/* Aktif destinasyon başlığı */}
      <div className="flex items-center gap-2">
        <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${destStyle.bg} ${destStyle.text} ${destStyle.border}`}>
          {destLabel}
        </span>
        <span className="text-xs text-gray-400">{initialShipments.length} sevkiyat</span>
      </div>

      {/* Create Shipment */}
      {canCreate && (
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Yeni Sevkiyat ({destLabel})
          </button>
        </div>
      )}

      {showCreate && canCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-blue-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Yeni Sevkiyat — {destLabel}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İsim</label>
              <input type="text" required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={`Gemi 70`}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Yöntem</label>
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
              {creating && <Loader2 className="w-4 h-4 animate-spin" />} Oluştur
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">İptal</button>
          </div>
        </form>
      )}

      {/* Pending indicator (tab switch) */}
      {isPending && <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>}

      {/* Open Shipments */}
      {!isPending && openShipments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Açık Sevkiyatlar</h2>
          {openShipments.map(s => <ShipmentCard key={s.id} shipment={s} />)}
        </div>
      )}

      {/* Closed Shipments */}
      {!isPending && closedShipments.length > 0 && (
        <details className="group">
          <summary className="text-sm font-semibold text-gray-500 uppercase tracking-wider cursor-pointer flex items-center gap-1">
            Kapalı Sevkiyatlar ({closedShipments.length})
            <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="mt-3 space-y-3">
            {closedShipments.map(s => <ShipmentCard key={s.id} shipment={s} />)}
          </div>
        </details>
      )}

      {/* Empty */}
      {!isPending && initialShipments.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border">
          <Ship className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{destLabel} hattında sevkiyat yok</h3>
          <p className="text-gray-500 text-sm">Yeni sevkiyat oluşturarak başlayın.</p>
        </div>
      )}
    </div>
  );
}

function ShipmentCard({ shipment }: { shipment: ShipmentDTO }) {
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
            <span>{shipment.stats.itemCount} ürün</span>
            <span>{shipment.stats.totalQty.toLocaleString('tr-TR')} ünite</span>
            <span>{shipment.stats.totalDesi.toLocaleString('tr-TR')} desi</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
