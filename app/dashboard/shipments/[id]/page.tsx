/**
 * Shipment Detail Page
 * View items, add items, dispatch shipment
 * Admin only
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Ship, Plus, Send, Loader2, AlertCircle,
  Package, Calendar, Anchor, Truck as TruckIcon, Plane, Trash2,
} from 'lucide-react';

interface ShipmentItem {
  id: string;
  iwasku: string;
  quantity: number;
  desi: number | null;
  marketplaceId: string | null;
  marketplace: { id: string; name: string; code: string } | null;
  reserveId: string | null;
  createdAt: string;
}

interface ShipmentDetail {
  id: string;
  name: string;
  destinationTab: string;
  shippingMethod: string;
  plannedDate: string;
  actualDate: string | null;
  etaDate: string | null;
  status: string;
  notes: string | null;
  items: ShipmentItem[];
}

const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  PLANNING: { label: 'Planlama', color: 'text-gray-600', bgColor: 'bg-gray-100' },
  LOADING: { label: 'Yükleme', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  IN_TRANSIT: { label: 'Yolda', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  DELIVERED: { label: 'Teslim Edildi', color: 'text-green-700', bgColor: 'bg-green-100' },
};

const methodIcons: Record<string, typeof Anchor> = { sea: Anchor, road: TruckIcon, air: Plane };
const methodLabels: Record<string, string> = { sea: 'Deniz', road: 'Karayolu', air: 'Hava' };

export default function ShipmentDetailPage() {
  const { role } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [addForm, setAddForm] = useState({ iwasku: '', quantity: '', desi: '' });
  const [adding, setAdding] = useState(false);

  const fetchShipment = useCallback(async () => {
    try {
      const res = await fetch(`/api/shipments/${id}`);
      const data = await res.json();
      if (data.success) setShipment(data.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchShipment(); }, [fetchShipment]);

  if (role !== 'admin') {
    return <div className="flex items-center justify-center min-h-[60vh]"><AlertCircle className="w-12 h-12 text-red-400" /></div>;
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  if (!shipment) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-gray-600">Sevkiyat bulunamadı</p>
        <Link href="/dashboard/shipments" className="text-blue-600 text-sm mt-2 inline-block">Geri dön</Link>
      </div>
    );
  }

  const config = statusConfig[shipment.status] ?? statusConfig.PLANNING;
  const MethodIcon = methodIcons[shipment.shippingMethod] ?? Anchor;
  const totalQty = shipment.items.reduce((s, i) => s + i.quantity, 0);
  const totalDesi = shipment.items.reduce((s, i) => s + (i.desi ?? 0) * i.quantity, 0);
  const canEdit = shipment.status === 'PLANNING' || shipment.status === 'LOADING';

  const handleStatusChange = async (newStatus: string) => {
    const labels: Record<string, string> = {
      LOADING: 'Yükleme başlasın mı?',
      IN_TRANSIT: 'Sevkiyat gönderilsin mi? (Depo çıkışları otomatik yapılacak)',
      DELIVERED: 'Teslim edildi olarak işaretlensin mi?',
    };
    if (!confirm(labels[newStatus] ?? `Durum ${newStatus} olarak değişsin mi?`)) return;

    const res = await fetch(`/api/shipments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: newStatus,
        ...(newStatus === 'IN_TRANSIT' ? { actualDate: new Date().toISOString() } : {}),
      }),
    });
    const data = await res.json();
    if (data.success) fetchShipment();
    else alert(data.error);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            iwasku: addForm.iwasku,
            quantity: parseInt(addForm.quantity),
            desi: addForm.desi ? parseFloat(addForm.desi) : undefined,
          }],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAddForm({ iwasku: '', quantity: '', desi: '' });
        setShowAddItem(false);
        fetchShipment();
      } else {
        alert(data.error);
      }
    } catch { alert('Hata'); } finally { setAdding(false); }
  };

  const plannedDate = new Date(shipment.plannedDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard/shipments')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <MethodIcon className="w-6 h-6 text-blue-500" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{shipment.name}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}>
                {config.label}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{shipment.destinationTab}</span>
              <span>·</span>
              <span>{methodLabels[shipment.shippingMethod]}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{plannedDate}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {shipment.status === 'PLANNING' && (
            <button onClick={() => handleStatusChange('LOADING')}
              className="px-3 py-2 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 flex items-center gap-2">
              <Package className="w-4 h-4" /> Yükleme Başlat
            </button>
          )}
          {shipment.status === 'LOADING' && (
            <button onClick={() => handleStatusChange('IN_TRANSIT')}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-2">
              <Send className="w-4 h-4" /> Gönder
            </button>
          )}
          {shipment.status === 'IN_TRANSIT' && (
            <button onClick={() => handleStatusChange('DELIVERED')}
              className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-2">
              Teslim Edildi
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{shipment.items.length}</p>
          <p className="text-xs text-gray-500">Ürün Çeşidi</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Toplam Ünite</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{Math.round(totalDesi).toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Toplam Desi</p>
        </div>
      </div>

      {/* Add Item */}
      {canEdit && (
        <div>
          <button onClick={() => setShowAddItem(!showAddItem)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Ürün Ekle
          </button>
          {showAddItem && (
            <form onSubmit={handleAddItem} className="mt-3 bg-white border border-blue-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">IWASKU</label>
                <input type="text" required value={addForm.iwasku}
                  onChange={e => setAddForm(f => ({ ...f, iwasku: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm w-48" placeholder="CA041C0A8DWG" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Miktar</label>
                <input type="number" required value={addForm.quantity}
                  onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm w-24" placeholder="50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Desi</label>
                <input type="number" step="0.1" value={addForm.desi}
                  onChange={e => setAddForm(f => ({ ...f, desi: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm w-24" placeholder="100" />
              </div>
              <button type="submit" disabled={adding}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {adding && <Loader2 className="w-4 h-4 animate-spin" />} Ekle
              </button>
            </form>
          )}
        </div>
      )}

      {/* Items Table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        {shipment.items.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Birim Desi</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Toplam Desi</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Eklenme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipment.items.map(item => {
                const unitDesi = item.desi ?? 0;
                const itemTotalDesi = unitDesi * item.quantity;
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm text-gray-900">{item.iwasku}</td>
                    <td className="px-3 py-3 text-sm text-gray-700">
                      {item.marketplace ? item.marketplace.code : '—'}
                    </td>
                    <td className="text-center px-3 py-3 font-semibold text-gray-900">{item.quantity}</td>
                    <td className="text-center px-3 py-3 text-sm text-gray-700">
                      {unitDesi > 0 ? unitDesi.toFixed(1) : '—'}
                    </td>
                    <td className="text-center px-3 py-3 text-sm font-medium text-gray-900">
                      {itemTotalDesi > 0 ? Math.round(itemTotalDesi).toLocaleString('tr-TR') : '—'}
                    </td>
                    <td className="text-center px-3 py-3 text-sm text-gray-600">
                      {new Date(item.createdAt).toLocaleDateString('tr-TR')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t">
              <tr className="font-semibold text-gray-900">
                <td className="px-4 py-3">Toplam</td>
                <td></td>
                <td className="text-center px-3 py-3">{totalQty.toLocaleString('tr-TR')}</td>
                <td></td>
                <td className="text-center px-3 py-3">{Math.round(totalDesi).toLocaleString('tr-TR')}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="text-center py-12">
            <Ship className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Henüz ürün eklenmedi</p>
          </div>
        )}
      </div>

      {shipment.notes && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-sm text-gray-600">{shipment.notes}</p>
        </div>
      )}
    </div>
  );
}
