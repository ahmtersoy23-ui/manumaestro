/**
 * Shipment Detail Page
 * 3 tabs: Bekleyen (pending) | Gönderilenler (sent) | Koliler (boxes, sea only)
 * Sea: box entry + sevkiyat kapat
 * Road/air: checkbox + parti gonderi
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Plus, Send, Loader2, AlertCircle, Pencil,
  Package, Calendar, Anchor, Truck as TruckIcon, Plane,
  Check, Square, CheckSquare, Download, Ship, X, ChevronDown, ChevronRight, Printer, Search, Copy,
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
  const [addForm, setAddForm] = useState({ iwasku: '', quantity: '', marketplaceId: '' });
  const [allMarketplaces, setAllMarketplaces] = useState<{ id: string; name: string; code: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSentIds, setSelectedSentIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [unsending, setUnsending] = useState(false);
  const [showExtraBox, setShowExtraBox] = useState(false);
  const [selectedBoxIds, setSelectedBoxIds] = useState<Set<string>>(new Set());
  const [settingDest, setSettingDest] = useState(false);
  const [showBulkFba, setShowBulkFba] = useState(false);
  const [bulkFbaText, setBulkFbaText] = useState('');
  const [bulkFbaResult, setBulkFbaResult] = useState<{ updated: number; notFound?: string[] } | null>(null);

  // Search & filter states
  const [itemSearch, setItemSearch] = useState('');
  const [boxSearch, setBoxSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('');
  const [itemMarketFilter, setItemMarketFilter] = useState('');
  const [boxCategoryFilter, setBoxCategoryFilter] = useState('');
  const [boxDestFilter, setBoxDestFilter] = useState('');
  const [boxMarketFilter, setBoxMarketFilter] = useState('');
  const [sentSearch, setSentSearch] = useState('');
  const [sentCategoryFilter, setSentCategoryFilter] = useState('');
  const [sentMarketFilter, setSentMarketFilter] = useState('');
  // Track printed box IDs
  const [printedBoxIds, setPrintedBoxIds] = useState<Set<string>>(new Set());
  // Editable cell tab navigation
  const [editingCell, setEditingCell] = useState<{ boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null>(null);

  // Depo çıkış onay modalı
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitItems, setExitItems] = useState<{ iwasku: string; name: string; quantity: number }[]>([]);
  const [exitWeek, setExitWeek] = useState('');
  const [exitSaving, setExitSaving] = useState(false);

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

  // Marketplace listesini çek (ürün ekleme formu için)
  useEffect(() => {
    fetch('/api/marketplaces').then(r => r.json()).then(data => {
      if (data.success) setAllMarketplaces(data.data);
    }).catch(() => {});
  }, []);

  // Marketplace code → name mapping (koliler tablosu icin) — hook, early return'den once olmali
  const mktCodeToName = useMemo(() => {
    const map = new Map<string, string>();
    if (shipment) {
      for (const item of shipment.items) {
        if (item.marketplace?.code && item.marketplace.name) {
          map.set(item.marketplace.code, item.marketplace.name);
        }
      }
    }
    return map;
  }, [shipment]);

  // Filtered items (search + dropdowns) — hook'lar early return'den once olmali
  const filteredPendingItems = useMemo(() => {
    let result = shipment?.items.filter(i => !i.sentAt) ?? [];
    if (itemSearch.trim()) {
      const q = itemSearch.toLowerCase();
      result = result.filter(i =>
        i.iwasku.toLowerCase().includes(q) ||
        (i.fnsku && i.fnsku.toLowerCase().includes(q)) ||
        (i.productName && i.productName.toLowerCase().includes(q))
      );
    }
    if (itemCategoryFilter) result = result.filter(i => i.productCategory === itemCategoryFilter);
    if (itemMarketFilter) result = result.filter(i => i.marketplace?.code === itemMarketFilter);
    return result;
  }, [shipment, itemSearch, itemCategoryFilter, itemMarketFilter]);

  const filteredBoxes = useMemo(() => {
    let result = boxes;
    if (boxSearch.trim()) {
      const q = boxSearch.toLowerCase();
      result = result.filter(b =>
        b.boxNumber.toLowerCase().includes(q) ||
        (b.iwasku && b.iwasku.toLowerCase().includes(q)) ||
        (b.productName && b.productName.toLowerCase().includes(q))
      );
    }
    if (boxCategoryFilter) result = result.filter(b => b.productCategory === boxCategoryFilter);
    if (boxDestFilter) result = result.filter(b => b.destination === boxDestFilter);
    if (boxMarketFilter) result = result.filter(b => b.marketplaceCode === boxMarketFilter);
    return result;
  }, [boxes, boxSearch, boxCategoryFilter, boxDestFilter, boxMarketFilter]);

  // Unique values for dropdown filters
  const itemCategories = useMemo(() => [...new Set((shipment?.items.filter(i => !i.sentAt) ?? []).map(i => i.productCategory).filter(Boolean))].sort(), [shipment]);
  const itemMarkets = useMemo(() => [...new Set((shipment?.items.filter(i => !i.sentAt) ?? []).map(i => i.marketplace?.code).filter(Boolean) as string[])].sort(), [shipment]);
  const boxCategories = useMemo(() => [...new Set(boxes.map(b => b.productCategory).filter(Boolean) as string[])].sort(), [boxes]);
  const boxMarkets = useMemo(() => [...new Set(boxes.map(b => b.marketplaceCode).filter(Boolean) as string[])].sort(), [boxes]);

  const filteredSentItems = useMemo(() => {
    let result = shipment?.items.filter(i => i.sentAt) ?? [];
    if (sentSearch.trim()) {
      const q = sentSearch.toLowerCase();
      result = result.filter(i =>
        i.iwasku.toLowerCase().includes(q) ||
        (i.fnsku && i.fnsku.toLowerCase().includes(q)) ||
        (i.productName && i.productName.toLowerCase().includes(q))
      );
    }
    if (sentCategoryFilter) result = result.filter(i => i.productCategory === sentCategoryFilter);
    if (sentMarketFilter) result = result.filter(i => i.marketplace?.code === sentMarketFilter);
    return result;
  }, [shipment, sentSearch, sentCategoryFilter, sentMarketFilter]);
  const sentCategories = useMemo(() => [...new Set((shipment?.items.filter(i => i.sentAt) ?? []).map(i => i.productCategory).filter(Boolean))].sort(), [shipment]);
  const sentMarkets = useMemo(() => [...new Set((shipment?.items.filter(i => i.sentAt) ?? []).map(i => i.marketplace?.code).filter(Boolean) as string[])].sort(), [shipment]);

  // Donor map: iwasku+quantity → ilk dolu koli (ölçü kopyalama için)
  const donorMap = useMemo(() => {
    const map = new Map<string, ShipmentBox>();
    for (const b of boxes) {
      const key = `${b.iwasku}|${b.quantity}`;
      if (b.width && b.depth && b.height && b.weight && !map.has(key)) {
        map.set(key, b);
      }
    }
    return map;
  }, [boxes]);

  // Izin kontrolu API uzerinden yapiliyor (permissions state)
  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  if (!shipment) return (
    <div className="text-center py-12"><AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" /><p className="text-gray-600">Sevkiyat bulunamadı</p>
      <Link href="/dashboard/shipments" className="text-blue-600 text-sm mt-2 inline-block">Geri dön</Link></div>
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
  const canUnsend = perms.unsendItems ?? false;
  const canDest = perms.setDestination ?? false;
  const canEdit = perms.createShipment ?? false; // manager = edit shipment info
  const pendingItems = shipment.items.filter(i => !i.sentAt);
  const sentItems = shipment.items.filter(i => i.sentAt);
  const totalQty = shipment.items.reduce((s, i) => s + i.quantity, 0);
  const totalItemDesi = shipment.items.reduce((s, i) => s + (i.desi ?? 0) * i.quantity, 0);
  const totalBoxDesi = boxes.reduce((s, b) => {
    const d = (b.width && b.depth && b.height) ? (b.width * b.depth * b.height / 5000) : 0;
    return s + d;
  }, 0);
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
    } catch { alert('Kaydetme hatası'); } finally { setSaving(false); }
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
    if (!confirm('Bu ürün sevkiyattan çıkarılsın mı?')) return;
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

  // Pazartesi hesapla (bugünün haftası)
  const getMonday = (d: Date) => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d);
    mon.setDate(diff);
    return mon.toISOString().split('T')[0];
  };

  // Depo çıkış modalını aç (gönderilen item'lar ile)
  const openExitModal = (sentItems: { iwasku: string; productName: string; quantity: number }[]) => {
    // IWASKU bazlı grupla
    const grouped = new Map<string, { iwasku: string; name: string; quantity: number }>();
    for (const item of sentItems) {
      const existing = grouped.get(item.iwasku);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        grouped.set(item.iwasku, { iwasku: item.iwasku, name: item.productName || item.iwasku, quantity: item.quantity });
      }
    }
    setExitItems([...grouped.values()]);
    setExitWeek(getMonday(new Date()));
    setShowExitModal(true);
  };

  // Depo çıkış onayı
  const handleConfirmExit = async () => {
    setExitSaving(true);
    try {
      const res = await fetch(`/api/shipments/${id}/warehouse-exit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: exitItems.map(i => ({ iwasku: i.iwasku, quantity: i.quantity })),
          weekStart: exitWeek,
        }),
      });
      const data = await res.json();
      if (data.success) setShowExitModal(false);
      else alert(data.error);
    } catch { alert('Çıkış kayıt hatası'); } finally { setExitSaving(false); }
  };

  // Karayolu/hava: seçili packed itemleri gönder
  const handleSendSelected = async () => {
    const toSend = [...selectedIds].filter(sid => {
      const item = pendingItems.find(i => i.id === sid);
      return item?.packed;
    });
    if (toSend.length === 0) return;
    if (!confirm(`${toSend.length} ürün gönderilsin mi?`)) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: toSend }),
      });
      const data = await res.json();
      if (data.success) {
        // Gönderilen item'ları al ve modal aç
        const sentItemDetails = toSend.map(sid => pendingItems.find(i => i.id === sid)!).filter(Boolean);
        setSelectedIds(new Set());
        await fetchShipment();
        openExitModal(sentItemDetails);
      } else alert(data.error);
    } catch { alert('Gönderim hatası'); } finally { setSending(false); }
  };

  // Gönderilmişleri geri al
  const handleUnsendSelected = async () => {
    const toUnsend = [...selectedSentIds];
    if (toUnsend.length === 0) return;
    if (!confirm(`${toUnsend.length} ürünün gönderimi geri alınsın mı?`)) return;
    setUnsending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/unsend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: toUnsend }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedSentIds(new Set());
        await fetchShipment();
      } else alert(data.error);
    } catch { alert('Geri alma hatası'); } finally { setUnsending(false); }
  };

  // Gönderilenleri depo çıkışı modalına gönder
  const handleExitForSent = () => {
    const items = [...selectedSentIds].map(sid => sentItems.find(i => i.id === sid)!).filter(Boolean);
    if (items.length === 0) return;
    openExitModal(items);
    setSelectedSentIds(new Set());
  };

  // Deniz: sevkiyatı kapat
  const handleCloseShipment = async () => {
    if (!confirm('Sevkiyat kapatılsın mı? Tüm ürünler gönderilmiş olarak işaretlenecek.')) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closeShipment: true }),
      });
      const data = await res.json();
      if (data.success) {
        // Tüm pending item'ları al ve modal aç
        const allPending = [...pendingItems];
        await fetchShipment();
        openExitModal(allPending);
      } else alert(data.error);
    } catch { alert('Kapama hatası'); } finally { setSending(false); }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault(); setAdding(true);
    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ iwasku: addForm.iwasku, quantity: parseInt(addForm.quantity), marketplaceId: addForm.marketplaceId || undefined }] }),
      });
      const data = await res.json();
      if (data.success) { setAddForm({ iwasku: '', quantity: '', marketplaceId: '' }); setShowAddItem(false); fetchShipment(); }
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
      return { '#': i + 1, 'Koli No': b.boxNumber, 'IWASKU': b.iwasku ?? '', 'FNSKU': b.fnsku ?? '', 'Ürün Adı': b.productName ?? '', 'Kategori': b.productCategory ?? '', 'Pazar Yeri': b.marketplaceCode ?? '', 'Hedef': b.destination, 'Adet': b.quantity, 'En': b.width ?? '', 'Boy': b.depth ?? '', 'Yuk.': b.height ?? '', 'Ağr.': b.weight ?? '', 'Desi': desi ? +desi.toFixed(1) : '' };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Koliler');
    XLSX.writeFile(wb, `${shipment.name}-koliler-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handlePrintBoxLabel = async (box: ShipmentBox) => {
    const [JsBarcode, { jsPDF }] = await Promise.all([
      import('jsbarcode').then(m => m.default),
      import('jspdf'),
    ]);

    const PX_PER_MM = 8;
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

    const name = box.productName || '';
    const marketplace = box.marketplaceCode || '';
    const code = box.fnsku || box.iwasku;
    const doc = new jsPDF({ unit: 'mm', format: [W_MM, H_MM], orientation: 'landscape' });

    // 5 adet koli no etiketi
    for (let i = 0; i < 5; i++) {
      if (i > 0) doc.addPage([W_MM, H_MM], 'landscape');

      const boxLabelImg = renderCanvasLabel((ctx) => {
        ctx.font = 'bold 100px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(box.boxNumber, CW / 2, 115);

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(24, 135);
        ctx.lineTo(CW - 24, 135);
        ctx.stroke();

        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${box.quantity} adet`, CW / 2, 175);

        ctx.font = '30px Arial';
        const nameLines = wrapText(ctx, name, CW - 60);
        let y = 210;
        for (const ln of nameLines.slice(0, 3)) {
          ctx.fillText(ln, CW / 2, y);
          y += 36;
        }

        ctx.font = '22px Arial';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.fillText(marketplace, CW - 24, CH - 16);
      });
      doc.addImage(boxLabelImg, 'PNG', 0, 0, W_MM, H_MM);
    }

    // Barkod etiketleri (quantity kadar, birer adet)
    if (code) {
      const label = box.fnsku ? 'FNSKU' : 'IWASKU';
      const bcCanvas = document.createElement('canvas');
      JsBarcode(bcCanvas, code, { format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0 });

      for (let i = 0; i < box.quantity; i++) {
        doc.addPage([W_MM, H_MM], 'landscape');

        const barcodeImg = renderCanvasLabel((ctx) => {
          const bw = 430, bh = 140;
          ctx.drawImage(bcCanvas, (CW - bw) / 2, 10, bw, bh);

          ctx.font = 'bold 28px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(`${code}  (${label})`, CW / 2, 178);

          ctx.font = '18px Arial';
          const lines = wrapText(ctx, name, CW - 40);
          let y = 204;
          for (const ln of lines.slice(0, 2)) {
            ctx.fillText(ln, CW / 2, y);
            y += 22;
          }

          ctx.font = '18px Courier New';
          ctx.fillStyle = '#888';
          ctx.textAlign = 'left';
          ctx.fillText(box.boxNumber, 16, CH - 10);
          ctx.textAlign = 'right';
          ctx.fillText(marketplace, CW - 16, CH - 10);
        });
        doc.addImage(barcodeImg, 'PNG', 0, 0, W_MM, H_MM);
      }
    }

    doc.save(`${box.boxNumber}.pdf`);
    setPrintedBoxIds(prev => new Set(prev).add(box.id));
  };

  // Ölçü kopyalama: aynı iwasku+quantity olan dolu koliden kopyala
  const handleCopyDimensions = async (targetBox: ShipmentBox, donorBox: ShipmentBox) => {
    const updates = { boxId: targetBox.id, width: donorBox.width, depth: donorBox.depth, height: donorBox.height, weight: donorBox.weight };
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if ((await res.json()).success) fetchBoxes();
    } catch { /* */ }
  };

  const handleExportItems = async () => {
    const XLSX = await loadXLSX();
    const rows = shipment.items.map((item, i) => ({ '#': i + 1, 'IWASKU': item.iwasku, 'FNSKU': item.fnsku ?? '', 'Ürün Adı': item.productName, 'Kategori': item.productCategory, 'Pazar Yeri': item.marketplace?.code ?? '', 'Miktar': item.quantity, 'Desi': item.desi ? Math.round(item.desi * item.quantity) : '', 'Durum': item.sentAt ? 'Gönderildi' : item.packed ? 'Hazır' : 'Bekliyor' }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ürünler');
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
                <button onClick={startEdit} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" title="Düzenle">
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
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ship className="w-4 h-4" />} Sevkiyatı Kapat
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
          <h3 className="font-semibold text-gray-900">Sevkiyat Bilgilerini Düzenle</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İsim</label>
              <input type="text" value={editForm.name} disabled className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Planlanan Tarih</label>
              <input type="date" value={editForm.plannedDate} onChange={e => setEditForm(f => ({ ...f, plannedDate: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tahmini Varış (ETA)</label>
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
            <button onClick={() => setEditing(false)} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">İptal</button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{shipment.items.length}</p><p className="text-xs text-gray-500">Toplam Ürün</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString('tr-TR')}</p><p className="text-xs text-gray-500">Toplam Ünite</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{Math.round(totalItemDesi).toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Ürün Desi</p>
          {isSea && totalBoxDesi > 0 && (
            <p className="text-xs text-blue-600 mt-1">{Math.round(totalBoxDesi).toLocaleString('tr-TR')} koli desi</p>
          )}
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{pendingItems.length}</p><p className="text-xs text-gray-500">Bekleyen</p>
          {sentItems.length > 0 && <p className="text-xs text-green-600 mt-1">{sentItems.length} gönderildi</p>}
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
                <p className="text-sm font-semibold text-amber-800">{missingFnsku.length} üründe FNSKU eksik</p>
                <p className="text-xs text-amber-600 mt-1">Tabloda &quot;Eksik&quot; yazan hücreye tıklayarak FNSKU girebilirsiniz.</p>
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
          {isSea ? `Ürünler (${pendingItems.length})` : `Bekleyen (${pendingItems.length})`}
        </button>
        {!isSea && (
          <button onClick={() => setActiveTab('sent')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'sent' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Gönderilenler ({sentItems.length})
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
                <Plus className="w-4 h-4" /> Ürün Ekle
              </button>
            )}
            <button onClick={handleExportItems} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
              <Download className="w-4 h-4" /> Excel
            </button>
            {pendingItems.length > 0 && (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                    placeholder="SKU, ürün adı..."
                    className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  {itemSearch && (
                    <button onClick={() => setItemSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {itemCategories.length > 1 && (
                  <select value={itemCategoryFilter} onChange={e => setItemCategoryFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Kategoriler</option>
                    {itemCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {itemMarkets.length > 1 && (
                  <select value={itemMarketFilter} onChange={e => setItemMarketFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Pazarlar</option>
                    {itemMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </>
            )}
            {/* Karayolu/hava: Gönder butonu */}
            {!isSea && canSend && selectedPackedCount > 0 && (
              <button onClick={handleSendSelected} disabled={sending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {selectedPackedCount} ürün gönder
              </button>
            )}
          </div>

          {showAddItem && (
            <form onSubmit={handleAddItem} className="bg-white border border-blue-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">IWASKU</label>
                <input type="text" required value={addForm.iwasku} onChange={e => setAddForm(f => ({ ...f, iwasku: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm w-48" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Miktar</label>
                <input type="number" required value={addForm.quantity} onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm w-24" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Pazaryeri</label>
                <select required value={addForm.marketplaceId} onChange={e => setAddForm(f => ({ ...f, marketplaceId: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm w-48">
                  <option value="">Seçiniz</option>
                  {allMarketplaces.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
                </select></div>
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
                        <button onClick={handleSelectAllPacked} className="text-gray-600 hover:text-purple-600" title="Hazırları seç">
                          {packedPendingCount > 0 && [...selectedIds].length >= packedPendingCount ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </button>
                      )}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">T. Desi</th>
                    {isActive && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPendingItems.map(item => {
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
              <div className="text-center py-12"><Check className="w-10 h-10 text-green-300 mx-auto mb-3" /><p className="text-gray-500">Bekleyen ürün yok</p></div>
            )}
          </div>
        </div>
      )}

      {/* === SENT TAB === */}
      {activeTab === 'sent' && (
        <div className="space-y-4">
          {/* Sent tab search/filter + action buttons */}
          {sentItems.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" value={sentSearch} onChange={e => setSentSearch(e.target.value)}
                  placeholder="SKU, ürün adı..."
                  className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {sentSearch && (
                  <button onClick={() => setSentSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {sentCategories.length > 1 && (
                <select value={sentCategoryFilter} onChange={e => setSentCategoryFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                  <option value="">Tüm Kategoriler</option>
                  {sentCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {sentMarkets.length > 1 && (
                <select value={sentMarketFilter} onChange={e => setSentMarketFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                  <option value="">Tüm Pazarlar</option>
                  {sentMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              {canSend && selectedSentIds.size > 0 && (
                <button onClick={handleExitForSent}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
                  <Package className="w-4 h-4" />
                  {selectedSentIds.size} ürün — Depo Çıkışı Kaydet
                </button>
              )}
              {canUnsend && selectedSentIds.size > 0 && (
                <button onClick={handleUnsendSelected} disabled={unsending}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50">
                  {unsending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  {selectedSentIds.size} ürün — Gönderimi Geri Al
                </button>
              )}
            </div>
          )}
          <div className="bg-white border rounded-xl overflow-hidden">
            {sentItems.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {(canSend || canUnsend) && (
                      <th className="w-12 px-3 py-3">
                        <button onClick={() => {
                          if (selectedSentIds.size === sentItems.length) setSelectedSentIds(new Set());
                          else setSelectedSentIds(new Set(sentItems.map(i => i.id)));
                        }} className="text-gray-600 hover:text-purple-600" title="Tümünü seç">
                          {selectedSentIds.size === sentItems.length && sentItems.length > 0 ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </button>
                      </th>
                    )}
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Gönderim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSentItems.map(item => (
                    <tr key={item.id} className={`${selectedSentIds.has(item.id) ? 'bg-blue-50/50' : 'bg-green-50/30'}`}>
                      {(canSend || canUnsend) && (
                        <td className="px-3 py-3">
                          <button onClick={() => {
                            const next = new Set(selectedSentIds);
                            next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                            setSelectedSentIds(next);
                          }} className="text-gray-500 hover:text-purple-600">
                            {selectedSentIds.has(item.id) ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5" />}
                          </button>
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-sm text-gray-900">{item.iwasku}</td>
                      <td className="px-3 py-3 font-mono text-sm text-gray-600">{item.fnsku || '—'}</td>
                      <td className="px-3 py-3 text-xs text-gray-700 line-clamp-1">{item.productName || '—'}</td>
                      <td className="px-3 py-3 text-sm text-gray-600">{item.productCategory || '—'}</td>
                      <td className="px-3 py-3 text-sm text-gray-600">{item.marketplace?.name ?? '—'}</td>
                      <td className="text-center px-3 py-3 font-semibold text-gray-900">{item.quantity}</td>
                      <td className="text-center px-3 py-3 text-xs text-green-700">
                        {item.sentAt ? new Date(item.sentAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12"><Ship className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Henüz gönderilen ürün yok</p></div>
            )}
          </div>
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
                Toplu FBA İşaretle
              </button>
            )}
            {boxes.length > 0 && (
              <button onClick={handleExportBoxes} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
                <Download className="w-4 h-4" /> Excel Koli Listesi
              </button>
            )}
            {boxes.length > 0 && (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={boxSearch} onChange={e => setBoxSearch(e.target.value)}
                    placeholder="Koli no, SKU, ürün..."
                    className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  {boxSearch && (
                    <button onClick={() => setBoxSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {boxCategories.length > 1 && (
                  <select value={boxCategoryFilter} onChange={e => setBoxCategoryFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Kategoriler</option>
                    {boxCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <select value={boxDestFilter} onChange={e => setBoxDestFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                  <option value="">Tüm Hedefler</option>
                  <option value="FBA">FBA</option>
                  <option value="DEPO">Depo</option>
                </select>
                {boxMarkets.length > 1 && (
                  <select value={boxMarketFilter} onChange={e => setBoxMarketFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                    <option value="">Tüm Pazarlar</option>
                    {boxMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
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
                <h3 className="text-sm font-semibold text-gray-900">Toplu FBA / Depo İşaretleme</h3>
                <button onClick={() => { setShowBulkFba(false); setBulkFbaResult(null); }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-gray-500">Koli numaralarını alt alta, virgül veya tab ile ayırarak girin:</p>
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
                  {settingDest && <Loader2 className="w-4 h-4 animate-spin" />} FBA Olarak İşaretle
                </button>
                <button onClick={() => handleBulkFbaSubmit('DEPO')} disabled={settingDest || !bulkFbaText.trim()}
                  className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  Depo Olarak İşaretle
                </button>
              </div>
              {bulkFbaResult && (
                <div className="text-sm">
                  <p className="text-green-700">{bulkFbaResult.updated} koli güncellendi.</p>
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
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Adet</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">En</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Boy</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Yuk.</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Agr.</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Desi</th>
                    <th className="w-8"></th>
                    <th className="w-10"></th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBoxes.map(box => {
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
                        <td className="px-3 py-3 text-sm text-gray-600">{(box.marketplaceCode && mktCodeToName.get(box.marketplaceCode)) || box.marketplaceCode || '—'}</td>
                        <td className="text-center px-3 py-3 font-semibold">{box.quantity}</td>
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="width" value={box.width} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="depth" value={box.depth} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="height" value={box.height} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <EditableBoxCell boxId={box.id} shipmentId={id} field="weight" value={box.weight} canEdit={isActive && canBoxes} onUpdated={fetchBoxes}
                          editingCell={editingCell} setEditingCell={setEditingCell} visibleBoxes={filteredBoxes} />
                        <td className="text-center px-3 py-3 font-medium text-gray-900">{boxDesi ? boxDesi.toFixed(1) : '—'}</td>
                        {(() => {
                          const donorKey = `${box.iwasku}|${box.quantity}`;
                          const donor = donorMap.get(donorKey);
                          const needsCopy = donor && donor.id !== box.id && (!box.width || !box.depth || !box.height || !box.weight);
                          return (
                            <td className="px-1 py-3 text-center">
                              {isActive && canBoxes && needsCopy ? (
                                <button onClick={() => handleCopyDimensions(box, donor)}
                                  className="text-blue-400 hover:text-blue-600 transition-colors"
                                  title={`Ölçüleri kopyala (${donor.width}×${donor.depth}×${donor.height}, ${donor.weight}kg)`}>
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              ) : null}
                            </td>
                          );
                        })()}
                        <td className="px-2 py-3 text-center">
                          <button onClick={() => handlePrintBoxLabel(box)}
                            className={`transition-colors ${printedBoxIds.has(box.id) ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-blue-600'}`}
                            title={printedBoxIds.has(box.id) ? 'Basıldı — tekrar bas' : 'Etiket bas'}>
                            <Printer className="w-4 h-4" />
                          </button>
                        </td>
                        <td className="px-2 py-3">{isActive && canBoxes && <button onClick={() => handleDeleteBox(box.id)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-12"><Package className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Henüz koli eklenmedi</p></div>
            )}
          </div>
        </div>
      )}

      {/* === DEPO ÇIKIŞ ONAY MODALI === */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Depo Çıkışı</h3>
              <button onClick={() => setShowExitModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Hafta (Pazartesi)</label>
                <input type="date" value={exitWeek} onChange={e => setExitWeek(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm w-44" />
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">IWASKU</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">Ürün Adı</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-600">Adet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {exitItems.map(item => (
                      <tr key={item.iwasku}>
                        <td className="px-4 py-2 font-mono text-sm">{item.iwasku}</td>
                        <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[200px]">{item.name}</td>
                        <td className="px-4 py-2 text-sm font-semibold text-right">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-gray-500">
                Toplam: <span className="font-semibold text-gray-900">{exitItems.reduce((s, i) => s + i.quantity, 0)}</span> adet
                ({exitItems.length} ürün)
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
              <button onClick={() => setShowExitModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Atla
              </button>
              <button onClick={handleConfirmExit} disabled={exitSaving || !exitWeek}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {exitSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Editable Box Cell (dimensions/weight) with Tab navigation ---
const FIELD_ORDER: ('width' | 'depth' | 'height' | 'weight')[] = ['width', 'depth', 'height', 'weight'];

function EditableBoxCell({ boxId, shipmentId, field, value, canEdit, onUpdated, editingCell, setEditingCell, visibleBoxes }: {
  boxId: string; shipmentId: string; field: 'width' | 'height' | 'depth' | 'weight';
  value: number | null; canEdit: boolean; onUpdated: () => void;
  editingCell: { boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null;
  setEditingCell: (cell: { boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null) => void;
  visibleBoxes: ShipmentBox[];
}) {
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);
  const tabNavigating = useRef(false);
  const isEditing = editingCell?.boxId === boxId && editingCell?.field === field;

  // Tab navigation ile açıldığında inputVal'ı set et
  useEffect(() => {
    if (isEditing) setInputVal(value?.toString() ?? '');
  }, [isEditing, value]);

  const navigateCell = (direction: 1 | -1) => {
    const fieldIdx = FIELD_ORDER.indexOf(field);
    const boxIdx = visibleBoxes.findIndex(b => b.id === boxId);
    let nextField = fieldIdx + direction;
    let nextBoxIdx = boxIdx;
    if (nextField >= FIELD_ORDER.length) { nextField = 0; nextBoxIdx++; }
    else if (nextField < 0) { nextField = FIELD_ORDER.length - 1; nextBoxIdx--; }
    if (nextBoxIdx >= 0 && nextBoxIdx < visibleBoxes.length) {
      setEditingCell({ boxId: visibleBoxes[nextBoxIdx].id, field: FIELD_ORDER[nextField] });
    } else {
      setEditingCell(null);
    }
  };

  const handleSave = async (andNavigate?: 1 | -1) => {
    const num = inputVal.trim() ? parseFloat(inputVal) : null;
    if (num !== null && (isNaN(num) || num <= 0)) {
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
      return;
    }
    if (num === value) {
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/boxes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId, [field]: num }),
      });
      if ((await res.json()).success) onUpdated();
    } catch { /* */ }
    finally {
      setSaving(false);
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
    }
  };

  if (!canEdit) {
    return <td className="text-center px-3 py-3 text-gray-600">{value ?? '—'}</td>;
  }

  if (isEditing) {
    return (
      <td className="text-center px-1 py-1">
        <input
          type="number" step="0.1" autoFocus
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Tab') { e.preventDefault(); tabNavigating.current = true; handleSave(e.shiftKey ? -1 : 1); }
            else if (e.key === 'Enter') { tabNavigating.current = true; handleSave(1); }
            else if (e.key === 'Escape') setEditingCell(null);
          }}
          onBlur={() => { if (!saving && !tabNavigating.current) handleSave(); tabNavigating.current = false; }}
          disabled={saving}
          className="w-14 px-1 py-0.5 border border-blue-300 rounded text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </td>
    );
  }

  return (
    <td
      className="text-center px-3 py-3 text-gray-600 cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors"
      onClick={() => setEditingCell({ boxId, field })}
      title="Düzenlemek için tıkla"
    >
      {value ?? '—'}
    </td>
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
    if (!countryCode) { setError('Marketplace eşleştirilemedi'); return; }

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
    } catch { setError('Bağlantı hatası'); } finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setValue(''); setError(''); }}
        className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium hover:bg-amber-200 transition-colors cursor-pointer"
        title="FNSKU girmek için tıkla"
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
                <button onClick={onTogglePacked} className="hover:scale-110 transition-transform" title={item.packed ? 'Hazır' : 'Hazırla'}>
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
        <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.marketplace?.name ?? '—'}</td>
        <td className={`text-center px-3 py-3 font-semibold ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.quantity}</td>
        <td className={`text-center px-3 py-3 font-medium ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{itemDesi > 0 ? Math.round(itemDesi).toLocaleString('tr-TR') : '—'}</td>
        {isActive && canDelete && (
          <td className="px-2 py-3 text-center">
            <button onClick={onDeleteItem} className="text-red-300 hover:text-red-600 transition-colors" title="Sevkiyattan çıkar"><X className="w-4 h-4" /></button>
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
        <div><label className="block text-xs text-gray-500 mb-0.5">Yükseklik</label><input type="number" step="0.1" value={height} onChange={e => setHeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ağırlık</label><input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
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
        <h3 className="text-sm font-semibold text-gray-900">Ek Koli (Üretim Dışı)</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="block text-xs text-gray-500 mb-0.5">IWASKU</label>
          <input type="text" value={f.iwasku} onChange={e => setF(p => ({ ...p, iwasku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-40" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">FNSKU</label>
          <input type="text" value={f.fnsku} onChange={e => setF(p => ({ ...p, fnsku: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-32 font-mono" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ürün Adı</label>
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
        <div><label className="block text-xs text-gray-500 mb-0.5">Yükseklik</label>
          <input type="number" step="0.1" value={f.height} onChange={e => setF(p => ({ ...p, height: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Ağırlık</label>
          <input type="number" step="0.01" value={f.weight} onChange={e => setF(p => ({ ...p, weight: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-20" /></div>
        <div><label className="block text-xs text-gray-500 mb-0.5">Çoğalt</label>
          <input type="number" min="1" max="200" value={f.count} onChange={e => setF(p => ({ ...p, count: e.target.value }))} className="px-2 py-1.5 border rounded text-sm w-16" /></div>
        <button type="submit" disabled={saving} className="self-end px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {parseInt(f.count) > 1 ? `${f.count} Koli Ekle` : 'Koli Ekle'}
        </button>
      </div>
    </form>
  );
}
