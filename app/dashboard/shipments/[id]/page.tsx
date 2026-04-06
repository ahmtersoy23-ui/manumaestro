/**
 * Shipment Detail Page
 * 3 tabs: Bekleyen (pending) | Gonderilenler (sent) | Koliler (boxes, sea only)
 * Sea: box entry + sevkiyat kapat
 * Road/air: checkbox + parti gonderi
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Plus, Send, Loader2, AlertCircle, Pencil,
  Package, Calendar, Anchor, Truck as TruckIcon, Plane,
  Check, Square, CheckSquare, Download, Ship, X, ChevronDown, ChevronRight, Printer,
} from 'lucide-react';

// --- Types ---
interface ShipmentItem {
  id: string; iwasku: string; quantity: number; desi: number | null;
  marketplaceId: string | null;
  marketplace: { id: string; name: string; code: string } | null;
  productName: string; productCategory: string; fnsku: string | null;
  reserveId: string | null; packed: boolean; sentAt: string | null; createdAt: string;
}
interface ShipmentBox {
  id: string; shipmentItemId: string | null; boxNumber: string;
  iwasku: string | null; fnsku: string | null;
  productName: string | null; productCategory: string | null;
  marketplaceCode: string | null; destination: string;
  quantity: number; width: number | null; height: number | null;
  depth: number | null; weight: number | null; createdAt: string;
}
interface ShipmentDetail {
  id: string; name: string; destinationTab: string; shippingMethod: string;
  plannedDate: string; actualDate: string | null; etaDate: string | null;
  status: string; notes: string | null; items: ShipmentItem[];
}
interface BoxFormData {
  iwasku?: string | null; fnsku?: string | null; productName?: string | null;
  productCategory?: string | null; marketplaceCode?: string | null;
  destination?: string;
  quantity: number; width?: number | null; height?: number | null;
  depth?: number | null; weight?: number | null;
}

const methodIcons: Record<string, typeof Anchor> = { sea: Anchor, road: TruckIcon, air: Plane };
const methodLabels: Record<string, string> = { sea: 'Deniz', road: 'Karayolu', air: 'Hava' };
const BOX_ENTRY_METHODS = new Set(['sea']);
const loadXLSX = () => import('xlsx');

export default function ShipmentDetailPage() {
  useAuth(); // Session check
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [boxes, setBoxes] = useState<ShipmentBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'sent' | 'boxes'>('pending');
  const [showAddItem, setShowAddItem] = useState(false);
  const [addForm, setAddForm] = useState({ iwasku: '', quantity: '', desi: '' });
  const [adding, setAdding] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [showExtraBox, setShowExtraBox] = useState(false);
  const [selectedBoxIds, setSelectedBoxIds] = useState<Set<string>>(new Set());
  const [settingDest, setSettingDest] = useState(false);
  const [showBulkFba, setShowBulkFba] = useState(false);
  const [bulkFbaText, setBulkFbaText] = useState('');
  const [bulkFbaResult, setBulkFbaResult] = useState<{ updated: number; notFound?: string[] } | null>(null);

  // Permissions from API
  const [perms, setPerms] = useState<Record<string, boolean>>({});

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', plannedDate: '', etaDate: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const fetchShipment = useCallback(async () => {
    try {
      const res = await fetch(`/api/shipments/${id}`);
      const data = await res.json();
      if (data.success) { setShipment(data.data); if (data.permissions) setPerms(data.permissions); }
    } catch { /* */ } finally { setLoading(false); }
  }, [id]);

  const fetchBoxes = useCallback(async () => {
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`);
      const data = await res.json();
      if (data.success) setBoxes(data.data);
    } catch { /* */ }
  }, [id]);

  useEffect(() => { fetchShipment(); fetchBoxes(); }, [fetchShipment, fetchBoxes]);

  // Izin kontrolu API uzerinden yapiliyor (permissions state)
  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  if (!shipment) return (
    <div className="text-center py-12"><AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" /><p className="text-gray-600">Sevkiyat bulunamadi</p>
      <Link href="/dashboard/shipments" className="text-blue-600 text-sm mt-2 inline-block">Geri don</Link></div>
  );

  const MethodIcon = methodIcons[shipment.shippingMethod] ?? Anchor;
  const isActive = shipment.status === 'PLANNING' || shipment.status === 'LOADING';
  const isSea = BOX_ENTRY_METHODS.has(shipment.shippingMethod);

  // Permission shortcuts
  const canRoute = perms.routeItems ?? false;
  const canDelete = perms.deleteItems ?? false;
  const canBoxes = perms.manageBoxes ?? false;
  const canPack = perms.packItems ?? false;
  const canSend = perms.sendItems ?? false;
  const canClose = perms.closeShipment ?? false;
  const canDest = perms.setDestination ?? false;
  const canEdit = perms.createShipment ?? false; // manager = edit shipment info
  const pendingItems = shipment.items.filter(i => !i.sentAt);
  const sentItems = shipment.items.filter(i => i.sentAt);
  const totalQty = shipment.items.reduce((s, i) => s + i.quantity, 0);
  const totalDesi = shipment.items.reduce((s, i) => s + (i.desi ?? 0) * i.quantity, 0);
  const packedPendingCount = pendingItems.filter(i => i.packed).length;
  const plannedDate = shipment.plannedDate
    ? new Date(shipment.plannedDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const startEdit = () => {
    setEditForm({
      name: shipment.name,
      plannedDate: shipment.plannedDate ? new Date(shipment.plannedDate).toISOString().split('T')[0] : '',
      etaDate: shipment.etaDate ? new Date(shipment.etaDate).toISOString().split('T')[0] : '',
      notes: shipment.notes ?? '',
    });
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: editForm.notes || undefined,
          ...(editForm.plannedDate ? { plannedDate: new Date(editForm.plannedDate).toISOString() } : {}),
          ...(editForm.etaDate ? { etaDate: new Date(editForm.etaDate).toISOString() } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) { setEditing(false); await fetchShipment(); }
      else alert(data.error);
    } catch { alert('Kaydetme hatasi'); } finally { setSaving(false); }
  };

  // --- Handlers ---
  const handleTogglePacked = async (itemId: string) => {
    setTogglingId(itemId);
    try {
      const res = await fetch(`/api/shipments/${id}/items/${itemId}`, { method: 'PATCH' });
      const data = await res.json();
      if (data.success) setShipment(prev => prev ? { ...prev, items: prev.items.map(i => i.id === itemId ? { ...i, packed: data.data.packed } : i) } : prev);
    } catch { /* */ } finally { setTogglingId(null); }
  };

  const handleToggleSelect = (itemId: string) => {
    const next = new Set(selectedIds);
    next.has(itemId) ? next.delete(itemId) : next.add(itemId);
    setSelectedIds(next);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Bu urun sevkiyattan cikarilsin mi?')) return;
    const res = await fetch(`/api/shipments/${id}/items/${itemId}`, { method: 'DELETE' });
    if ((await res.json()).success) await Promise.all([fetchShipment(), fetchBoxes()]);
  };

  const handleSelectAllPacked = () => {
    const packedPendingIds = pendingItems.filter(i => i.packed).map(i => i.id);
    if (packedPendingIds.every(id => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(packedPendingIds));
    }
  };

  // Karayolu/hava: seçili packed itemleri gönder
  const handleSendSelected = async () => {
    const toSend = [...selectedIds].filter(sid => {
      const item = pendingItems.find(i => i.id === sid);
      return item?.packed;
    });
    if (toSend.length === 0) return;
    if (!confirm(`${toSend.length} urun gonderilsin mi?`)) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: toSend }),
      });
      const data = await res.json();
      if (data.success) { setSelectedIds(new Set()); await fetchShipment(); }
      else alert(data.error);
    } catch { alert('Gonderim hatasi'); } finally { setSending(false); }
  };

  // Deniz: sevkiyatı kapat
  const handleCloseShipment = async () => {
    if (!confirm('Sevkiyat kapatilsin mi? Tum urunler gonderilmis olarak isaretlenecek.')) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closeShipment: true }),
      });
      const data = await res.json();
      if (data.success) await fetchShipment();
      else alert(data.error);
    } catch { alert('Kapama hatasi'); } finally { setSending(false); }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault(); setAdding(true);
    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ iwasku: addForm.iwasku, quantity: parseInt(addForm.quantity), desi: addForm.desi ? parseFloat(addForm.desi) : undefined }] }),
      });
      const data = await res.json();
      if (data.success) { setAddForm({ iwasku: '', quantity: '', desi: '' }); setShowAddItem(false); fetchShipment(); }
      else alert(data.error);
    } catch { alert('Hata'); } finally { setAdding(false); }
  };

  const handleCreateBox = async (form: BoxFormData, shipmentItemId: string | null) => {
    const res = await fetch(`/api/shipments/${id}/boxes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, shipmentItemId }),
    });
    const data = await res.json();
    if (data.success) { await Promise.all([fetchBoxes(), fetchShipment()]); return data.data as ShipmentBox; }
    else { alert(data.error); return null; }
  };

  const handleDeleteBox = async (boxId: string) => {
    if (!confirm('Bu koli silinsin mi?')) return;
    const res = await fetch(`/api/shipments/${id}/boxes?boxId=${boxId}`, { method: 'DELETE' });
    if ((await res.json()).success) await Promise.all([fetchBoxes(), fetchShipment()]);
  };

  const handleSetDestination = async (destination: 'FBA' | 'DEPO') => {
    const ids = [...selectedBoxIds];
    if (ids.length === 0) return;
    setSettingDest(true);
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxIds: ids, destination }),
      });
      const data = await res.json();
      if (data.success) {
        setBoxes(prev => prev.map(b => ids.includes(b.id) ? { ...b, destination } : b));
        setSelectedBoxIds(new Set());
      }
    } catch { /* */ } finally { setSettingDest(false); }
  };

  const handleBulkFbaSubmit = async (dest: 'FBA' | 'DEPO') => {
    const numbers = bulkFbaText.split(/[\n,;\t]+/).map(s => s.trim()).filter(Boolean);
    if (numbers.length === 0) return;
    setSettingDest(true); setBulkFbaResult(null);
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxNumbers: numbers, destination: dest }),
      });
      const data = await res.json();
      if (data.success) {
        setBulkFbaResult(data.data);
        await fetchBoxes();
        if (data.data.updated > 0) setBulkFbaText('');
      }
    } catch { /* */ } finally { setSettingDest(false); }
  };

  const handleToggleBoxSelect = (boxId: string) => {
    const next = new Set(selectedBoxIds);
    next.has(boxId) ? next.delete(boxId) : next.add(boxId);
    setSelectedBoxIds(next);
  };

  const handleSelectAllBoxes = () => {
    if (selectedBoxIds.size === boxes.length) setSelectedBoxIds(new Set());
    else setSelectedBoxIds(new Set(boxes.map(b => b.id)));
  };

  const handleExportBoxes = async () => {
    const XLSX = await loadXLSX();
    const rows = boxes.map((b, i) => {
      const desi = (b.width && b.depth && b.height) ? (b.width * b.depth * b.height / 5000) : null;
      return { '#': i + 1, 'Koli No': b.boxNumber, 'IWASKU': b.iwasku ?? '', 'FNSKU': b.fnsku ?? '', 'Urun Adi': b.productName ?? '', 'Kategori': b.productCategory ?? '', 'Pazar Yeri': b.marketplaceCode ?? '', 'Hedef': b.destination, 'Adet': b.quantity, 'En': b.width ?? '', 'Boy': b.depth ?? '', 'Yuk.': b.height ?? '', 'Agr.': b.weight ?? '', 'Desi': desi ? +desi.toFixed(1) : '' };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Koliler');
    XLSX.writeFile(wb, `${shipment.name}-koliler-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handlePrintLabels = async () => {
    const [JsBarcode, { jsPDF }] = await Promise.all([
      import('jsbarcode').then(m => m.default),
      import('jspdf'),
    ]);

    // Canvas ile etiket render (Turkce karakter destegi)
    const PX_PER_MM = 8; // 8px/mm ≈ 200dpi
    const W_MM = 60, H_MM = 40;
    const CW = W_MM * PX_PER_MM, CH = H_MM * PX_PER_MM;

    const renderCanvasLabel = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = CW; c.height = CH;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = '#000';
      draw(ctx);
      return c.toDataURL('image/png');
    };

    // Word-wrap helper
    const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const doc = new jsPDF({ unit: 'mm', format: [W_MM, H_MM], orientation: 'landscape' });
    let pageAdded = false;

    for (const box of boxes) {
      const code = box.fnsku || box.iwasku;
      if (!code) continue;
      const label = box.fnsku ? 'FNSKU' : 'IWASKU';
      const name = box.productName || '';
      const marketplace = box.marketplaceCode || '';

      // === SAYFA 1: Koli etiketi ===
      if (pageAdded) doc.addPage([W_MM, H_MM], 'landscape');
      pageAdded = true;

      const boxLabelImg = renderCanvasLabel((ctx) => {
        // Büyük koli numarası
        ctx.font = 'bold 100px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(box.boxNumber, CW / 2, 115);

        // Çizgi
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(24, 135);
        ctx.lineTo(CW - 24, 135);
        ctx.stroke();

        // Adet + ürün adı
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center';
        const fullText = `${box.quantity} adet`;
        ctx.fillText(fullText, CW / 2, 175);

        ctx.font = '30px Arial';
        const nameLines = wrapText(ctx, name, CW - 60);
        let y = 210;
        for (const ln of nameLines.slice(0, 3)) {
          ctx.fillText(ln, CW / 2, y);
          y += 36;
        }

        // Alt: hedef + marketplace
        ctx.font = '22px Arial';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'left';
        ctx.fillText(box.destination, 24, CH - 16);
        ctx.textAlign = 'right';
        ctx.fillText(marketplace, CW - 24, CH - 16);
      });
      doc.addImage(boxLabelImg, 'PNG', 0, 0, W_MM, H_MM);

      // === SAYFA 2+: Barkod etiketleri (quantity kadar) ===
      for (let i = 0; i < box.quantity; i++) {
        doc.addPage([W_MM, H_MM], 'landscape');

        // Barkod canvas
        const bcCanvas = document.createElement('canvas');
        JsBarcode(bcCanvas, code, {
          format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0,
        });
        const barcodeDataUrl = bcCanvas.toDataURL('image/png');

        const barcodeImg = renderCanvasLabel((ctx) => {
          // Barkod image
          const img = new Image();
          img.src = barcodeDataUrl;
          const bw = 400, bh = 110;
          ctx.drawImage(bcCanvas, (CW - bw) / 2, 16, bw, bh);

          // Kod text
          ctx.font = 'bold 32px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(code, CW / 2, 160);

          // Etiket tipi
          ctx.font = 'bold 26px Arial';
          ctx.fillText(label, CW / 2, 192);

          // Ürün adı (wrap)
          ctx.font = '22px Arial';
          const lines = wrapText(ctx, name, CW - 48);
          let y = 222;
          for (const ln of lines.slice(0, 2)) {
            ctx.fillText(ln, CW / 2, y);
            y += 28;
          }

          // Sol alt: koli no
          ctx.font = '20px Courier New';
          ctx.fillStyle = '#888';
          ctx.textAlign = 'left';
          ctx.fillText(box.boxNumber, 16, CH - 12);

          // Sağ alt: pazar yeri
          ctx.textAlign = 'right';
          ctx.fillText(marketplace, CW - 16, CH - 12);
        });
        doc.addImage(barcodeImg, 'PNG', 0, 0, W_MM, H_MM);
      }
    }

    if (!pageAdded) {
      alert('Etiket basılacak koli bulunamadı (FNSKU veya IWASKU gerekli)');
      return;
    }
    doc.save(`${shipment.name}-etiketler.pdf`);
  };

  const handleExportItems = async () => {
    const XLSX = await loadXLSX();
    const rows = shipment.items.map((item, i) => ({ '#': i + 1, 'IWASKU': item.iwasku, 'FNSKU': item.fnsku ?? '', 'Urun Adi': item.productName, 'Kategori': item.productCategory, 'Pazar Yeri': item.marketplace?.code ?? '', 'Miktar': item.quantity, 'Desi': item.desi ? Math.round(item.desi * item.quantity) : '', 'Durum': item.sentAt ? 'Gonderildi' : item.packed ? 'Hazir' : 'Bekliyor' }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Urunler');
    XLSX.writeFile(wb, `${shipment.name}-urunler-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Selected packed items count
  const selectedPackedCount = [...selectedIds].filter(sid => pendingItems.find(i => i.id === sid)?.packed).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard/shipments')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
          <MethodIcon className="w-6 h-6 text-blue-500" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{shipment.name}</h1>
              {isActive && canEdit && !editing && (
                <button onClick={startEdit} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" title="Duzenle">
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{shipment.destinationTab}</span><span>·</span>
              <span>{methodLabels[shipment.shippingMethod]}</span>
              {plannedDate && <><span>·</span><span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{plannedDate}</span></>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {isActive && isSea && canClose && pendingItems.length > 0 && (
            <button onClick={handleCloseShipment} disabled={sending}
              className="px-3 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ship className="w-4 h-4" />} Sevkiyati Kapat
            </button>
          )}
          {!isActive && shipment.status === 'IN_TRANSIT' && (
            <button onClick={async () => {
              if (!confirm('Teslim edildi?')) return;
              const res = await fetch(`/api/shipments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DELIVERED' }) });
              if ((await res.json()).success) fetchShipment();
            }} className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-2">Teslim Edildi</button>
          )}
        </div>
      </div>

      {/* Edit Panel */}
      {editing && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Sevkiyat Bilgilerini Duzenle</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Isim</label>
              <input type="text" value={editForm.name} disabled className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Planlanan Tarih</label>
              <input type="date" value={editForm.plannedDate} onChange={e => setEditForm(f => ({ ...f, plannedDate: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tahmini Varis (ETA)</label>
              <input type="date" value={editForm.etaDate} onChange={e => setEditForm(f => ({ ...f, etaDate: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Not</label>
              <input type="text" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Sevkiyat notu..." />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSaveEdit} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Kaydet
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">Iptal</button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{shipment.items.length}</p><p className="text-xs text-gray-500">Toplam Urun</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString('tr-TR')}</p><p className="text-xs text-gray-500">Toplam Unite</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{Math.round(totalDesi).toLocaleString('tr-TR')}</p><p className="text-xs text-gray-500">Toplam Desi</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{pendingItems.length}</p><p className="text-xs text-gray-500">Bekleyen</p>
          {sentItems.length > 0 && <p className="text-xs text-green-600 mt-1">{sentItems.length} gonderildi</p>}
        </div>
      </div>

      {/* FNSKU Eksik Uyarisi */}
      {(() => {
        const missingFnsku = pendingItems.filter(i => !i.fnsku && i.marketplace?.code?.startsWith('AMZN'));
        if (missingFnsku.length === 0) return null;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">{missingFnsku.length} urunde FNSKU eksik</p>
                <p className="text-xs text-amber-600 mt-1">Tabloda &quot;Eksik&quot; yazan hucreye tiklayarak FNSKU girebilirsiniz.</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {missingFnsku.map(i => (
                    <span key={i.id} className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs font-mono">{i.iwasku}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        <button onClick={() => setActiveTab('pending')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'pending' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          {isSea ? `Urunler (${pendingItems.length})` : `Bekleyen (${pendingItems.length})`}
        </button>
        {!isSea && (
          <button onClick={() => setActiveTab('sent')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'sent' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Gonderilenler ({sentItems.length})
          </button>
        )}
        {isSea && (
          <button onClick={() => setActiveTab('boxes')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'boxes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Koliler ({boxes.length})
          </button>
        )}
      </div>

      {/* === PENDING TAB === */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {isActive && canRoute && (
              <button onClick={() => setShowAddItem(!showAddItem)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Urun Ekle
              </button>
            )}
            <button onClick={handleExportItems} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
              <Download className="w-4 h-4" /> Excel
            </button>
            {/* Karayolu/hava: Gönder butonu */}
            {!isSea && canSend && selectedPackedCount > 0 && (
              <button onClick={handleSendSelected} disabled={sending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {selectedPackedCount} urun gonder
              </button>
            )}
          </div>

          {showAddItem && (
            <form onSubmit={handleAddItem} className="bg-white border border-blue-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">IWASKU</label>
                <input type="text" required value={addForm.iwasku} onChange={e => setAddForm(f => ({ ...f, iwasku: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm w-48" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Miktar</label>
                <input type="number" required value={addForm.quantity} onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm w-24" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Desi</label>
                <input type="number" step="0.1" value={addForm.desi} onChange={e => setAddForm(f => ({ ...f, desi: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm w-24" /></div>
              <button type="submit" disabled={adding} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {adding && <Loader2 className="w-4 h-4 animate-spin" />} Ekle</button>
            </form>
          )}

          {/* Pending items table */}
          <div className="bg-white border rounded-xl overflow-hidden">
            {pendingItems.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="w-12 px-3 py-3">
                      {isActive && !isSea && canSend && packedPendingCount > 0 && (
                        <button onClick={handleSelectAllPacked} className="text-gray-600 hover:text-purple-600" title="Hazirlari sec">
                          {packedPendingCount > 0 && [...selectedIds].length >= packedPendingCount ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </button>
                      )}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Urun Adi</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">T. Desi</th>
                    {isActive && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingItems.map(item => {
                    const itemDesi = (item.desi ?? 0) * item.quantity;
                    const isExpanded = expandedItemId === item.id;
                    const itemBoxes = boxes.filter(b => b.shipmentItemId === item.id);
                    return (
                      <PendingItemRow key={item.id} item={item} itemDesi={itemDesi} itemBoxes={itemBoxes}
                        isSea={isSea} isActive={isActive} isExpanded={isExpanded}
                        isSelected={selectedIds.has(item.id)} togglingId={togglingId}
                        canBoxes={canBoxes} canPack={canPack} canSend={canSend} canDelete={canDelete}
                        onTogglePacked={() => handleTogglePacked(item.id)}
                        onToggleSelect={() => handleToggleSelect(item.id)}
                        onToggleExpand={() => setExpandedItemId(isExpanded ? null : item.id)}
                        onCreateBox={(form) => handleCreateBox(form, item.id)}
                        onDeleteBox={handleDeleteBox}
                        onDeleteItem={() => handleDeleteItem(item.id)}
                        onFnskuSaved={(itemId, fnsku) => {
                          setShipment(prev => prev ? {
                            ...prev,
                            items: prev.items.map(i => i.id === itemId ? { ...i, fnsku } : i),
                          } : prev);
                        }} />
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12"><Check className="w-10 h-10 text-green-300 mx-auto mb-3" /><p className="text-gray-500">Bekleyen urun yok</p></div>
            )}
          </div>
        </div>
      )}

      {/* === SENT TAB === */}
      {activeTab === 'sent' && (
        <div className="bg-white border rounded-xl overflow-hidden">
          {sentItems.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Urun Adi</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                  <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                  <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Gonderim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sentItems.map(item => (
                  <tr key={item.id} className="bg-green-50/30">
                    <td className="px-4 py-3 font-mono text-sm text-gray-900">{item.iwasku}</td>
                    <td className="px-3 py-3 font-mono text-sm text-gray-600">{item.fnsku || '—'}</td>
                    <td className="px-3 py-3 text-xs text-gray-700 line-clamp-1">{item.productName || '—'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{item.productCategory || '—'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{item.marketplace?.code ?? '—'}</td>
                    <td className="text-center px-3 py-3 font-semibold text-gray-900">{item.quantity}</td>
                    <td className="text-center px-3 py-3 text-xs text-green-700">
                      {item.sentAt ? new Date(item.sentAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12"><Ship className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Henuz gonderilen urun yok</p></div>
          )}
        </div>
      )}

      {/* === BOXES TAB === */}
      {activeTab === 'boxes' && isSea && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {isActive && canBoxes && (
              <button onClick={() => setShowExtraBox(!showExtraBox)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Ek Koli
              </button>
            )}
            {canDest && boxes.length > 0 && (
              <button onClick={() => setShowBulkFba(!showBulkFba)} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600">
                Toplu FBA Isaretle
              </button>
            )}
            {boxes.length > 0 && (
              <>
                <button onClick={handleExportBoxes} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
                  <Download className="w-4 h-4" /> Excel Koli Listesi
                </button>
                <button onClick={handlePrintLabels} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
                  <Printer className="w-4 h-4" /> Etiket Yazdir
                </button>
              </>
            )}
            {/* Bulk FBA/DEPO toggle */}
            {canDest && selectedBoxIds.size > 0 && (
              <>
                <button onClick={() => handleSetDestination('FBA')} disabled={settingDest}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50">
                  {settingDest ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {selectedBoxIds.size} koli → FBA
                </button>
                <button onClick={() => handleSetDestination('DEPO')} disabled={settingDest}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
                  {selectedBoxIds.size} koli → Depo
                </button>
              </>
            )}
          </div>
          {showExtraBox && (
            <ExtraBoxForm onSubmit={async (form) => { const r = await handleCreateBox(form, null); if (r) setShowExtraBox(false); }} onCancel={() => setShowExtraBox(false)} />
          )}
          {showBulkFba && (
            <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Toplu FBA / Depo Isaretleme</h3>
                <button onClick={() => { setShowBulkFba(false); setBulkFbaResult(null); }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-gray-500">Koli numaralarini alt alta, virgul veya tab ile ayirarak girin:</p>
              <textarea
                value={bulkFbaText}
                onChange={e => setBulkFbaText(e.target.value)}
                placeholder={"69-0001\n69-0002\n69-0003"}
                rows={6}
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono resize-y"
              />
              <div className="flex items-center gap-3">
                <button onClick={() => handleBulkFbaSubmit('FBA')} disabled={settingDest || !bulkFbaText.trim()}
                  className="px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2">
                  {settingDest && <Loader2 className="w-4 h-4 animate-spin" />} FBA Olarak Isaretle
                </button>
                <button onClick={() => handleBulkFbaSubmit('DEPO')} disabled={settingDest || !bulkFbaText.trim()}
                  className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  Depo Olarak Isaretle
                </button>
              </div>
              {bulkFbaResult && (
                <div className="text-sm">
                  <p className="text-green-700">{bulkFbaResult.updated} koli guncellendi.</p>
                  {bulkFbaResult.notFound && bulkFbaResult.notFound.length > 0 && (
                    <p className="text-red-600 mt-1">Bulunamayan: {bulkFbaResult.notFound.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="bg-white border rounded-xl overflow-hidden">
            {boxes.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <button onClick={handleSelectAllBoxes} className="text-gray-600 hover:text-purple-600">
                        {selectedBoxIds.size === boxes.length && boxes.length > 0 ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                      </button>
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Koli No</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Hedef</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Urun Adi</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Adet</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">En</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Boy</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Yuk.</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Agr.</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Desi</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {boxes.map(box => {
                    const boxDesi = (box.width && box.depth && box.height) ? (box.width * box.depth * box.height / 5000) : null;
                    const isFba = box.destination === 'FBA';
                    return (
                      <tr key={box.id} className={`hover:bg-gray-50 ${isFba ? 'bg-orange-50/40' : ''}`}>
                        <td className="px-3 py-3 text-center">
                          <button onClick={() => handleToggleBoxSelect(box.id)} className="hover:scale-110 transition-transform">
                            {selectedBoxIds.has(box.id) ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5 text-gray-300" />}
                          </button>
                        </td>
                        <td className="px-3 py-3 font-mono text-sm font-semibold text-gray-900">{box.boxNumber}</td>
                        <td className="px-3 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${isFba ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                            {isFba ? 'FBA' : 'Depo'}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-mono text-sm text-gray-700">{box.iwasku || '—'}</td>
                        <td className="px-3 py-3 font-mono text-sm text-gray-600">{box.fnsku || '—'}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 line-clamp-1">{box.productName || '—'}</td>
                        <td className="px-3 py-3 text-sm text-gray-600">{box.marketplaceCode || '—'}</td>
                        <td className="text-center px-3 py-3 font-semibold">{box.quantity}</td>
                        <td className="text-center px-3 py-3 text-gray-600">{box.width ?? '—'}</td>
                        <td className="text-center px-3 py-3 text-gray-600">{box.depth ?? '—'}</td>
                        <td className="text-center px-3 py-3 text-gray-600">{box.height ?? '—'}</td>
                        <td className="text-center px-3 py-3 text-gray-600">{box.weight ?? '—'}</td>
                        <td className="text-center px-3 py-3 font-medium text-gray-900">{boxDesi ? boxDesi.toFixed(1) : '—'}</td>
                        <td className="px-2 py-3">{isActive && canBoxes && <button onClick={() => handleDeleteBox(box.id)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12"><Package className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Henuz koli eklenmedi</p></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Inline FNSKU Input ---
const MKT_CODE_TO_COUNTRY: Record<string, string> = {
  AMZN_US: 'US', AMZN_CA: 'CA', AMZN_UK: 'UK', AMZN_AU: 'AU', AMZN_EU: 'FR',
};

function InlineFnskuInput({ item, onSaved }: { item: ShipmentItem; onSaved: (itemId: string, fnsku: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const fnsku = value.trim();
    if (!fnsku) { setEditing(false); return; }
    const countryCode = item.marketplace?.code ? MKT_CODE_TO_COUNTRY[item.marketplace.code] : null;
    if (!countryCode) { setError('Marketplace eslestirilemedi'); return; }

    setSaving(true); setError('');
    try {
      const res = await fetch('/api/sku-master/fnsku', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentItemId: item.id, iwasku: item.iwasku, countryCode, fnsku }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved(item.id, data.data.fnsku ?? fnsku);
        setEditing(false);
      } else {
        setError(data.error || 'Hata');
      }
    } catch { setError('Baglanti hatasi'); } finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setValue(''); setError(''); }}
        className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium hover:bg-amber-200 transition-colors cursor-pointer"
        title="FNSKU girmek icin tikla"
      >
        Eksik
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          placeholder="FNSKU"
          disabled={saving}
          className="px-1.5 py-0.5 border border-amber-300 rounded text-xs font-mono w-28 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
        ) : (
          <>
            <button onClick={handleSave} className="text-green-600 hover:text-green-800"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
          </>
        )}
      </div>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

// --- Pending Item Row ---
function PendingItemRow({ item, itemDesi, itemBoxes, isSea, isActive, isExpanded, isSelected, togglingId,
  canBoxes, canPack, canSend, canDelete,
  onTogglePacked, onToggleSelect, onToggleExpand, onCreateBox, onDeleteBox, onDeleteItem, onFnskuSaved }: {
  item: ShipmentItem; itemDesi: number; itemBoxes: ShipmentBox[];
  isSea: boolean; isActive: boolean; isExpanded: boolean; isSelected: boolean; togglingId: string | null;
  canBoxes: boolean; canPack: boolean; canSend: boolean; canDelete: boolean;
  onTogglePacked: () => void; onToggleSelect: () => void; onToggleExpand: () => void;
  onCreateBox: (form: BoxFormData) => Promise<ShipmentBox | null>; onDeleteBox: (boxId: string) => void;
  onDeleteItem: () => void;
  onFnskuSaved: (itemId: string, fnsku: string) => void;
}) {
  // Deniz renk kodlama: kolilerdeki toplam adet vs item miktar
  const boxQtyTotal = itemBoxes.reduce((s, b) => s + b.quantity, 0);
  const rowBg = isSea
    ? (itemBoxes.length === 0 ? '' : boxQtyTotal >= item.quantity ? 'bg-green-50' : 'bg-amber-50/60')
    : (item.packed ? 'bg-green-50/50' : '');

  return (
    <>
      <tr className={`hover:bg-gray-50 ${rowBg}`}>
        <td className="px-3 py-3 text-center">
          {isActive && isSea && canBoxes ? (
            <button onClick={onToggleExpand} className="hover:scale-110 transition-transform">
              {isExpanded ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
            </button>
          ) : isActive && !isSea ? (
            <div className="flex items-center gap-1 justify-center">
              {item.packed && canSend && (
                <button onClick={onToggleSelect} className="hover:scale-110 transition-transform">
                  {isSelected ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5 text-gray-300" />}
                </button>
              )}
              {canPack && (togglingId === item.id ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                <button onClick={onTogglePacked} className="hover:scale-110 transition-transform" title={item.packed ? 'Hazir' : 'Hazirla'}>
                  {item.packed ? <Check className="w-4 h-4 text-green-600" /> : <Package className="w-4 h-4 text-gray-300" />}
                </button>
              ))}
            </div>
          ) : item.packed ? <Check className="w-5 h-5 text-green-600" /> : null}
        </td>
        <td className={`px-3 py-3 font-mono text-sm ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.iwasku}</td>
        <td className="px-3 py-3">
          {item.fnsku
            ? <span className={`font-mono text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.fnsku}</span>
            : item.marketplace?.code?.startsWith('AMZN')
              ? <InlineFnskuInput item={item} onSaved={onFnskuSaved} />
              : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-3"><div className={`text-xs leading-tight line-clamp-2 ${item.packed ? 'text-green-700' : 'text-gray-700'}`}>{item.productName || '—'}</div></td>
        <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.productCategory || '—'}</td>
        <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.marketplace?.code ?? '—'}</td>
        <td className={`text-center px-3 py-3 font-semibold ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.quantity}</td>
        <td className={`text-center px-3 py-3 font-medium ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{itemDesi > 0 ? Math.round(itemDesi).toLocaleString('tr-TR') : '—'}</td>
        {isActive && canDelete && (
          <td className="px-2 py-3 text-center">
            <button onClick={onDeleteItem} className="text-red-300 hover:text-red-600 transition-colors" title="Sevkiyattan cikar"><X className="w-4 h-4" /></button>
          </td>
        )}
      </tr>
      {isExpanded && isActive && isSea && canBoxes && (
        <tr><td colSpan={10} className="px-4 py-3 bg-blue-50/50 border-t border-blue-100">
          <BoxEntryPanel item={item} existingBoxes={itemBoxes} onCreateBox={onCreateBox} onDeleteBox={onDeleteBox} />
        </td></tr>
      )}
    </>
  );
}

// --- Box Entry Panel ---
function BoxEntryPanel({ item, existingBoxes, onCreateBox, onDeleteBox }: {
  item: ShipmentItem; existingBoxes: ShipmentBox[];
  onCreateBox: (form: BoxFormData) => Promise<ShipmentBox | null>; onDeleteBox: (boxId: string) => void;
}) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [width, setWidth] = useState(''); const [height, setHeight] = useState('');
  const [depth, setDepth] = useState(''); const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await onCreateBox({ iwasku: item.iwasku, fnsku: item.fnsku, productName: item.productName, productCategory: item.productCategory,
        marketplaceCode: item.marketplace?.code ?? null, quantity: parseInt(quantity) || 1,
        width: width ? parseFloat(width) : null, height: height ? parseFloat(height) : null,
        depth: depth ? parseFloat(depth) : null, weight: weight ? parseFloat(weight) : null });
      setQuantity(String(item.quantity)); setWidth(''); setHeight(''); setDepth(''); setWeight('');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {existingBoxes.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-1">Mevcut koliler:</p>
          {existingBoxes.map(box => (
            <div key={box.id} className="flex items-center gap-3 text-xs bg-white rounded px-3 py-1.5 border">
              <span className="font-mono font-semibold text-gray-900">{box.boxNumber}</span>
              <span className="text-gray-500">{box.quantity} adet</span>
              {box.width && <span className="text-gray-500">{box.width}x{box.depth}x{box.height}cm</span>}
              {box.weight && <span className="text-gray-500">{box.weight}kg</span>}
              <button onClick={() => onDeleteBox(box.id)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end">
        <div><label className="block text-xs text-gray-500 mb-0.5">Adet</label><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-16" required /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">En</label><input type="number" step="0.1" value={width} onChange={e => setWidth(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Boy</label><input type="number" step="0.1" value={depth} onChange={e => setDepth(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Yukseklik</label><input type="number" step="0.1" value={height} onChange={e => setHeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Agirlik</label><input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Koli Ekle</button>
      </form>
    </div>
  );
}

// --- Extra Box Form ---
function ExtraBoxForm({ onSubmit, onCancel }: { onSubmit: (form: BoxFormData) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({ iwasku: '', fnsku: '', productName: '', productCategory: '', marketplaceCode: '', quantity: '1', count: '1', width: '', height: '', depth: '', weight: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const count = parseInt(f.count) || 1;
      for (let i = 0; i < count; i++) {
        await onSubmit({
          iwasku: f.iwasku || null, fnsku: f.fnsku || null,
          productName: f.productName || null, productCategory: f.productCategory || null,
          marketplaceCode: f.marketplaceCode || null, quantity: parseInt(f.quantity) || 1,
          width: f.width ? parseFloat(f.width) : null, height: f.height ? parseFloat(f.height) : null,
          depth: f.depth ? parseFloat(f.depth) : null, weight: f.weight ? parseFloat(f.weight) : null,
        });
      }
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-blue-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Ek Koli (Uretim Disi)</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="block text-xs text-gray-500 mb-0.5">IWASKU</label>
          <input type="text" value={f.iwasku} onChange={e => setF(p => ({ ...p, iwasku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-40" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">FNSKU</label>
          <input type="text" value={f.fnsku} onChange={e => setF(p => ({ ...p, fnsku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-32 font-mono" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Urun Adi</label>
          <input type="text" value={f.productName} onChange={e => setF(p => ({ ...p, productName: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-48" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Kategori</label>
          <input type="text" value={f.productCategory} onChange={e => setF(p => ({ ...p, productCategory: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-36" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Pazar Yeri</label>
          <input type="text" value={f.marketplaceCode} onChange={e => setF(p => ({ ...p, marketplaceCode: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-24" /></div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="block text-xs text-gray-500 mb-0.5">Adet/Koli</label>
          <input type="number" value={f.quantity} onChange={e => setF(p => ({ ...p, quantity: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-16" required /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">En</label>
          <input type="number" step="0.1" value={f.width} onChange={e => setF(p => ({ ...p, width: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Boy</label>
          <input type="number" step="0.1" value={f.depth} onChange={e => setF(p => ({ ...p, depth: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Yukseklik</label>
          <input type="number" step="0.1" value={f.height} onChange={e => setF(p => ({ ...p, height: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Agirlik</label>
          <input type="number" step="0.01" value={f.weight} onChange={e => setF(p => ({ ...p, weight: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Cogalt</label>
          <input type="number" min="1" max="200" value={f.count} onChange={e => setF(p => ({ ...p, count: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-16" /></div>
        <button type="submit" disabled={saving} className="self-end px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {parseInt(f.count) > 1 ? `${f.count} Koli Ekle` : 'Koli Ekle'}
        </button>
      </div>
    </form>
  );
}
