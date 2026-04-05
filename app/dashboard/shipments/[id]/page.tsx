/**
 * Shipment Detail Page
 * View items with pack status, add items, dispatch shipment
 * Warehouse worker can check off items individually + export Excel packing list
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Plus, Send, Loader2, AlertCircle,
  Package, Calendar, Anchor, Truck as TruckIcon, Plane,
  Check, Square, CheckSquare, Download, Ship,
} from 'lucide-react';

interface ShipmentItem {
  id: string;
  iwasku: string;
  quantity: number;
  desi: number | null;
  marketplaceId: string | null;
  marketplace: { id: string; name: string; code: string } | null;
  productName: string;
  productCategory: string;
  reserveId: string | null;
  packed: boolean;
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
  LOADING: { label: 'Yukleme', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  IN_TRANSIT: { label: 'Yolda', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  DELIVERED: { label: 'Teslim Edildi', color: 'text-green-700', bgColor: 'bg-green-100' },
};

const methodIcons: Record<string, typeof Anchor> = { sea: Anchor, road: TruckIcon, air: Plane };
const methodLabels: Record<string, string> = { sea: 'Deniz', road: 'Karayolu', air: 'Hava' };

// Lazy-load XLSX
const loadXLSX = () => import('xlsx');

export default function ShipmentDetailPage() {
  const { role } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [addForm, setAddForm] = useState({ iwasku: '', quantity: '', desi: '' });
  const [adding, setAdding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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
        <p className="text-gray-600">Sevkiyat bulunamadi</p>
        <Link href="/dashboard/shipments" className="text-blue-600 text-sm mt-2 inline-block">Geri don</Link>
      </div>
    );
  }

  const config = statusConfig[shipment.status] ?? statusConfig.PLANNING;
  const MethodIcon = methodIcons[shipment.shippingMethod] ?? Anchor;
  const totalQty = shipment.items.reduce((s, i) => s + i.quantity, 0);
  const totalDesi = shipment.items.reduce((s, i) => s + (i.desi ?? 0) * i.quantity, 0);
  const packedCount = shipment.items.filter(i => i.packed).length;
  const totalItems = shipment.items.length;
  const allPacked = totalItems > 0 && packedCount === totalItems;
  const canEdit = shipment.status === 'PLANNING' || shipment.status === 'LOADING';
  const isLoading = shipment.status === 'LOADING';

  const handleStatusChange = async (newStatus: string) => {
    const labels: Record<string, string> = {
      LOADING: 'Yukleme baslasin mi?',
      IN_TRANSIT: 'Sevkiyat gonderilsin mi? (Depo cikislari otomatik yapilacak)',
      DELIVERED: 'Teslim edildi olarak isaretlensin mi?',
    };
    if (!confirm(labels[newStatus] ?? `Durum ${newStatus} olarak degissin mi?`)) return;

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

  const handleTogglePacked = async (itemId: string) => {
    setTogglingId(itemId);
    try {
      const res = await fetch(`/api/shipments/${id}/items/${itemId}`, { method: 'PATCH' });
      const data = await res.json();
      if (data.success) {
        setShipment(prev => prev ? {
          ...prev,
          items: prev.items.map(i => i.id === itemId ? { ...i, packed: data.data.packed } : i),
        } : prev);
      }
    } catch { /* ignore */ } finally { setTogglingId(null); }
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
      } else { alert(data.error); }
    } catch { alert('Hata'); } finally { setAdding(false); }
  };

  const handleExportExcel = async () => {
    const XLSX = await loadXLSX();
    const rows = shipment.items.map((item, idx) => ({
      '#': idx + 1,
      'IWASKU': item.iwasku,
      'Urun Adi': item.productName,
      'Kategori': item.productCategory,
      'Pazar Yeri': item.marketplace?.code ?? '',
      'Miktar': item.quantity,
      'Birim Desi': item.desi ?? '',
      'Toplam Desi': item.desi ? Math.round(item.desi * item.quantity) : '',
      'Hazir': item.packed ? 'Evet' : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    // Sütun genişlikleri
    ws['!cols'] = [
      { wch: 4 }, { wch: 16 }, { wch: 40 }, { wch: 20 },
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 6 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Paketleme Listesi');
    XLSX.writeFile(wb, `${shipment.name}-paketleme-${new Date().toISOString().split('T')[0]}.xlsx`);
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
          {shipment.status === 'PLANNING' && totalItems > 0 && (
            <button onClick={() => handleStatusChange('LOADING')}
              className="px-3 py-2 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 flex items-center gap-2">
              <Package className="w-4 h-4" /> Yukleme Baslat
            </button>
          )}
          {shipment.status === 'LOADING' && allPacked && (
            <button onClick={() => handleStatusChange('IN_TRANSIT')}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-2">
              <Send className="w-4 h-4" /> Gonder
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalItems}</p>
          <p className="text-xs text-gray-500">Urun Cesidi</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Toplam Unite</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{Math.round(totalDesi).toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Toplam Desi</p>
        </div>
        {(isLoading || shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED') && (
          <div className="bg-white border rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${allPacked ? 'text-green-600' : 'text-orange-600'}`}>
              {packedCount}/{totalItems}
            </p>
            <p className="text-xs text-gray-500">Hazirlanma</p>
          </div>
        )}
      </div>

      {/* Progress bar (loading state) */}
      {isLoading && totalItems > 0 && (
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Paketleme Durumu</span>
            <span className="text-sm text-gray-500">{packedCount}/{totalItems} hazir</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-300 ${allPacked ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${totalItems > 0 ? (packedCount / totalItems) * 100 : 0}%` }}
            />
          </div>
          {allPacked && (
            <p className="mt-2 text-sm text-green-600 font-medium flex items-center gap-1">
              <Check className="w-4 h-4" /> Tum urunler hazir — gonderime hazir!
            </p>
          )}
        </div>
      )}

      {/* Actions: Add Item + Export */}
      <div className="flex items-center gap-3">
        {canEdit && (
          <button onClick={() => setShowAddItem(!showAddItem)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Urun Ekle
          </button>
        )}
        {totalItems > 0 && (
          <button onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
            <Download className="w-4 h-4" /> Excel Liste
          </button>
        )}
      </div>

      {/* Add Item Form */}
      {showAddItem && (
        <form onSubmit={handleAddItem} className="bg-white border border-blue-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
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
              className="px-3 py-2 border rounded-lg text-sm w-24" placeholder="5.9" />
          </div>
          <button type="submit" disabled={adding}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {adding && <Loader2 className="w-4 h-4 animate-spin" />} Ekle
          </button>
        </form>
      )}

      {/* Items Table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        {totalItems > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {isLoading && <th className="w-12 px-3 py-3"></th>}
                <th className="text-left px-4 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Urun Adi</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">B. Desi</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">T. Desi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipment.items.map(item => {
                const unitDesi = item.desi ?? 0;
                const itemTotalDesi = unitDesi * item.quantity;
                return (
                  <tr key={item.id} className={`hover:bg-gray-50 ${item.packed ? 'bg-green-50/50' : ''}`}>
                    {isLoading && (
                      <td className="px-3 py-3 text-center">
                        {togglingId === item.id ? (
                          <Loader2 className="w-5 h-5 text-gray-400 animate-spin mx-auto" />
                        ) : (
                          <button onClick={() => handleTogglePacked(item.id)} className="hover:scale-110 transition-transform">
                            {item.packed
                              ? <CheckSquare className="w-5 h-5 text-green-600" />
                              : <Square className="w-5 h-5 text-gray-400" />}
                          </button>
                        )}
                      </td>
                    )}
                    <td className={`px-4 py-3 font-mono text-sm ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>
                      {item.iwasku}
                    </td>
                    <td className="px-3 py-3">
                      <div className={`text-xs leading-tight line-clamp-2 ${item.packed ? 'text-green-700' : 'text-gray-700'}`}>
                        {item.productName || '—'}
                      </div>
                    </td>
                    <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>
                      {item.productCategory || '—'}
                    </td>
                    <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>
                      {item.marketplace?.code ?? '—'}
                    </td>
                    <td className={`text-center px-3 py-3 font-semibold ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>
                      {item.quantity}
                    </td>
                    <td className={`text-center px-3 py-3 ${item.packed ? 'text-green-600' : 'text-gray-700'}`}>
                      {unitDesi > 0 ? unitDesi.toFixed(1) : '—'}
                    </td>
                    <td className={`text-center px-3 py-3 font-medium ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>
                      {itemTotalDesi > 0 ? Math.round(itemTotalDesi).toLocaleString('tr-TR') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t">
              <tr className="font-semibold text-gray-900">
                {isLoading && <td></td>}
                <td className="px-4 py-3">Toplam</td>
                <td></td>
                <td></td>
                <td></td>
                <td className="text-center px-3 py-3">{totalQty.toLocaleString('tr-TR')}</td>
                <td></td>
                <td className="text-center px-3 py-3">{Math.round(totalDesi).toLocaleString('tr-TR')}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="text-center py-12">
            <Ship className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Henuz urun eklenmedi</p>
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
