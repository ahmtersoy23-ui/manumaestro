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
  Check, Square, CheckSquare, Download, Ship, X, ChevronDown, ChevronRight, Printer, Search, Copy, RefreshCw,
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
  depth: number | null; weight: number | null; labelPrinted: boolean; createdAt: string;
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

// GPSR etiket asset'leri (base64 PNG)
const GPSR_LOGO_B64 = 'data:image/png;base64,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';
const GPSR_EURP_B64 = 'data:image/png;base64,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';
const GPSR_SYMBOLS_B64 = 'data:image/png;base64,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';

export default function ShipmentDetailPage() {
  const { role } = useAuth(); // Session check
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
  // Track printed box IDs (DB'den başlat)
  const printedBoxIds = useMemo(() => new Set(boxes.filter(b => b.labelPrinted).map(b => b.id)), [boxes]);
  // Editable cell tab navigation
  const [editingCell, setEditingCell] = useState<{ boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null>(null);

  // Depo çıkış onay modalı
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitItems, setExitItems] = useState<{ iwasku: string; name: string; quantity: number }[]>([]);
  const [exitWeek, setExitWeek] = useState('');
  const [exitSaving, setExitSaving] = useState(false);
  const [exitPage, setExitPage] = useState(0);
  // Karayolu/hava: Bekleyen tabında gönderilecek miktar override
  const [sendQtyOverrides, setSendQtyOverrides] = useState<Record<string, number>>({});
  // StockPulse export modalı
  const [showSPExport, setShowSPExport] = useState(false);
  const [spCopied, setSpCopied] = useState<'fba' | 'depo' | null>(null);

  // Permissions from API
  const [perms, setPerms] = useState<Record<string, boolean>>({});

  // FNSKU sync state
  const [syncingFnskuBoxId, setSyncingFnskuBoxId] = useState<string | null>(null);

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

  // StockPulse export: kutuları FBA/DEPO olarak grupla, iwasku bazlı topla
  const spExportData = useMemo(() => {
    const fba = new Map<string, number>();
    const depo = new Map<string, number>();
    for (const box of boxes) {
      if (!box.iwasku) continue;
      const target = box.destination === 'FBA' ? fba : depo;
      target.set(box.iwasku, (target.get(box.iwasku) ?? 0) + box.quantity);
    }
    const toTsv = (map: Map<string, number>) =>
      [...map.entries()].map(([sku, qty]) => `${sku}\t${qty}`).join('\n');
    return {
      fba: { items: fba, tsv: toTsv(fba), total: [...fba.values()].reduce((s, v) => s + v, 0) },
      depo: { items: depo, tsv: toTsv(depo), total: [...depo.values()].reduce((s, v) => s + v, 0) },
    };
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
    setExitPage(0);
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

  // Karayolu/hava: seçili packed itemleri gönder (kısmi miktar destekli)
  const handleSendSelected = async () => {
    const toSend = [...selectedIds]
      .map(sid => pendingItems.find(i => i.id === sid))
      .filter((item): item is ShipmentItem => !!item?.packed);
    if (toSend.length === 0) return;
    const sendItems = toSend.map(item => ({
      id: item.id,
      quantity: sendQtyOverrides[item.id] ?? item.quantity,
    }));
    const totalQtySend = sendItems.reduce((s, i) => s + i.quantity, 0);
    if (!confirm(`${toSend.length} ürün, toplam ${totalQtySend} adet gönderilsin mi?`)) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: sendItems }),
      });
      const data = await res.json();
      if (data.success) {
        // Gönderilen miktarlarla modal aç
        const sentItemDetails = toSend.map(item => ({
          ...item,
          quantity: sendQtyOverrides[item.id] ?? item.quantity,
        }));
        setSelectedIds(new Set());
        // Gönderilen override'ları temizle
        setSendQtyOverrides(prev => {
          const next = { ...prev };
          for (const item of toSend) delete next[item.id];
          return next;
        });
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
        await fetchShipment();
        // Koli toplamlarından depo çıkış modalını aç (talep değil, gerçek koli miktarları)
        const boxRes = await fetch(`/api/shipments/${id}/boxes`);
        const boxData = await boxRes.json();
        if (boxData.success && boxData.data.length > 0) {
          const boxItems = (boxData.data as ShipmentBox[])
            .filter(b => b.iwasku)
            .map(b => ({ iwasku: b.iwasku!, productName: b.productName || b.iwasku!, quantity: b.quantity }));
          openExitModal(boxItems);
        }
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

  const handleSyncFnsku = async (boxId: string) => {
    setSyncingFnskuBoxId(boxId);
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId, syncFnsku: true }),
      });
      const data = await res.json();
      if (data.success) {
        setBoxes(prev => prev.map(b => b.id === boxId ? { ...b, fnsku: data.data.fnsku } : b));
      }
    } finally {
      setSyncingFnskuBoxId(null);
    }
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

  const handleExportShipmate = async () => {
    const usBoxes = boxes.filter(b => b.marketplaceCode === 'AMZN_US' && b.fnsku);
    if (usBoxes.length === 0) return alert('Amazon US pazar yerine ait FNSKU\'lu koli bulunamadı.');
    const XLSX = await loadXLSX();
    const rows = usBoxes.map(b => ({
      koli_no: b.boxNumber,
      name: b.productName ?? '',
      fnsku: b.fnsku ?? '',
      quantity: b.quantity,
      weight: b.weight ?? '',
      length: b.depth ?? '',
      width: b.width ?? '',
      height: b.height ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 50 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Shipmate');
    XLSX.writeFile(wb, `${shipment.name}-shipmate-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const preloadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img); // devam et, boş çiz
      img.src = src;
    });

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
      const isEU = /^AMZN_(UK|EU|DE|FR|IT|ES|NL|SE|PL|BE)$/.test(marketplace);
      const sn = (name.split(' ')[0]) || '';
      const bcCanvas = document.createElement('canvas');
      JsBarcode(bcCanvas, code, { format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0 });

      // EU asset'leri preload
      const [gpsrLogo, gpsrEurp, gpsrSymbols] = isEU
        ? await Promise.all([preloadImage(GPSR_LOGO_B64), preloadImage(GPSR_EURP_B64), preloadImage(GPSR_SYMBOLS_B64)])
        : [null, null, null];

      for (let i = 0; i < box.quantity; i++) {
        doc.addPage([W_MM, H_MM], 'landscape');

        const barcodeImg = renderCanvasLabel((ctx) => {
          if (isEU) {
            // === EU/UK: FNSKU barcode + GPSR bilgisi ===
            const bw = 420, bh = 120; // barcode min 1.5cm = 120px
            ctx.drawImage(bcCanvas, (CW - bw) / 2, 6, bw, bh);

            ctx.font = 'bold 22px Courier New';
            ctx.textAlign = 'center';
            ctx.fillText(`${code}  (${label})`, CW / 2, 146);

            ctx.font = '15px Arial';
            const prodLine = wrapText(ctx, name, CW - 30);
            ctx.fillText(prodLine[0] || '', CW / 2, 166);

            // Ayırıcı çizgi
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(12, 174);
            ctx.lineTo(CW - 12, 174);
            ctx.stroke();

            // GPSR bilgileri — sol: logo + semboller, sağ: metin
            ctx.fillStyle = '#000';

            // Sol: Logo (tam) + EURP ikonu + semboller (preloaded)
            if (gpsrLogo) ctx.drawImage(gpsrLogo, 10, 178, 44, 44);
            if (gpsrEurp) ctx.drawImage(gpsrEurp, 14, 224, 16, 26);
            if (gpsrSymbols) ctx.drawImage(gpsrSymbols, 10, 254, 110, 28);

            // Sağ: metin bilgileri
            ctx.textAlign = 'left';
            const gx = 62;

            ctx.font = 'bold 14px Arial';
            ctx.fillText('IWA Concept Ltd.Sti.', gx, 190);

            ctx.font = '12px Arial';
            ctx.fillText('Ankara/TR · iwaconcept.com', gx, 204);

            ctx.font = '12px Arial';
            ctx.fillText('RP: Emre Bedel', gx, 218);
            ctx.fillText('responsible@iwaconcept.com', gx, 230);

            ctx.font = 'bold 13px Courier New';
            ctx.fillText(`PN: ${box.iwasku || code}`, gx, 246);
            if (sn) ctx.fillText(`SN: ${sn}`, gx + 200, 246);

            // Sağ alt: Complies badge
            ctx.font = 'bold 11px Arial';
            ctx.fillStyle = '#000';
            ctx.textAlign = 'right';
            ctx.fillText('Complies with', CW - 16, 256);
            ctx.fillText('GPSD / GPSR', CW - 16, 270);

            // Alt satır: koli no + marketplace
            ctx.font = '16px Courier New';
            ctx.fillStyle = '#666';
            ctx.textAlign = 'left';
            ctx.fillText(box.boxNumber, 16, CH - 8);
            ctx.textAlign = 'right';
            ctx.fillText(marketplace, CW - 16, CH - 8);
          } else {
            // === US/CA/AU: Mevcut layout (GPSR yok) ===
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
          }
        });
        doc.addImage(barcodeImg, 'PNG', 0, 0, W_MM, H_MM);
      }
    }

    doc.save(`${box.boxNumber}.pdf`);
    // DB'de labelPrinted işaretle
    try {
      await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId: box.id, labelPrinted: true }),
      });
      fetchBoxes();
    } catch { /* */ }
  };

  // Karayolu/hava: ürün satırından GPSR'lı FNSKU etiket bas
  const handlePrintItemLabel = async (item: ShipmentItem, labelCount: number) => {
    const code = item.fnsku || item.iwasku;
    if (!code || labelCount < 1) return;

    const [JsBarcode, { jsPDF }] = await Promise.all([
      import('jsbarcode').then(m => m.default),
      import('jspdf'),
    ]);

    const PX_PER_MM = 8;
    const W_MM = 60, H_MM = 40;
    const CW = W_MM * PX_PER_MM, CH = H_MM * PX_PER_MM;

    const renderCanvas = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = CW; c.height = CH;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = '#000';
      draw(ctx);
      return c.toDataURL('image/png');
    };

    const wrapLine = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else { line = test; }
      }
      if (line) lines.push(line);
      return lines;
    };

    const label = item.fnsku ? 'FNSKU' : 'IWASKU';
    const marketplace = item.marketplace?.code || '';
    const itemName = item.productName || '';
    const sn = itemName.split(' ')[0] || '';
    const isEU = /^AMZN_(UK|EU|DE|FR|IT|ES|NL|SE|PL|BE)$/.test(marketplace);

    const bcCanvas = document.createElement('canvas');
    JsBarcode(bcCanvas, code, { format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0 });

    // EU asset'leri preload
    const [gpsrLogo, gpsrEurp, gpsrSymbols] = isEU
      ? await Promise.all([preloadImage(GPSR_LOGO_B64), preloadImage(GPSR_EURP_B64), preloadImage(GPSR_SYMBOLS_B64)])
      : [null, null, null];

    const doc = new jsPDF({ unit: 'mm', format: [W_MM, H_MM], orientation: 'landscape' });

    for (let i = 0; i < labelCount; i++) {
      if (i > 0) doc.addPage([W_MM, H_MM], 'landscape');

      const img = renderCanvas((ctx) => {
        if (isEU) {
          const bw = 420, bh = 120;
          ctx.drawImage(bcCanvas, (CW - bw) / 2, 6, bw, bh);
          ctx.font = 'bold 22px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(`${code}  (${label})`, CW / 2, 146);
          ctx.font = '15px Arial';
          const prodLine = wrapLine(ctx, itemName, CW - 30);
          ctx.fillText(prodLine[0] || '', CW / 2, 166);
          ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(12, 174); ctx.lineTo(CW - 12, 174); ctx.stroke();
          ctx.fillStyle = '#000';
          // Sol: Logo (tam) + EURP ikonu + semboller (preloaded)
          if (gpsrLogo) ctx.drawImage(gpsrLogo, 10, 178, 44, 44);
          if (gpsrEurp) ctx.drawImage(gpsrEurp, 14, 224, 16, 26);
          if (gpsrSymbols) ctx.drawImage(gpsrSymbols, 10, 254, 110, 28);
          // Sağ: metin
          ctx.textAlign = 'left';
          const gx = 62;
          ctx.font = 'bold 14px Arial';
          ctx.fillText('IWA Concept Ltd.Sti.', gx, 190);
          ctx.font = '12px Arial';
          ctx.fillText('Ankara/TR · iwaconcept.com', gx, 204);
          ctx.fillText('RP: Emre Bedel', gx, 218);
          ctx.fillText('responsible@iwaconcept.com', gx, 230);
          ctx.font = 'bold 13px Courier New';
          ctx.fillText(`PN: ${item.iwasku || code}`, gx, 246);
          if (sn) ctx.fillText(`SN: ${sn}`, gx + 200, 246);
          // Sağ alt: Complies badge
          ctx.font = 'bold 11px Arial'; ctx.fillStyle = '#000';
          ctx.textAlign = 'right';
          ctx.fillText('Complies with', CW - 16, 256);
          ctx.fillText('GPSD / GPSR', CW - 16, 270);
          ctx.font = '16px Courier New'; ctx.fillStyle = '#666';
          ctx.textAlign = 'right';
          ctx.fillText(marketplace, CW - 16, CH - 8);
        } else {
          const bw = 430, bh = 140;
          ctx.drawImage(bcCanvas, (CW - bw) / 2, 10, bw, bh);
          ctx.font = 'bold 28px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(`${code}  (${label})`, CW / 2, 178);
          ctx.font = '18px Arial';
          const lines = wrapLine(ctx, itemName, CW - 40);
          let y = 204;
          for (const ln of lines.slice(0, 2)) { ctx.fillText(ln, CW / 2, y); y += 22; }
          ctx.font = '18px Courier New'; ctx.fillStyle = '#888';
          ctx.textAlign = 'right';
          ctx.fillText(marketplace, CW - 16, CH - 10);
        }
      });
      doc.addImage(img, 'PNG', 0, 0, W_MM, H_MM);
    }

    doc.save(`${item.iwasku}-${label}-x${labelCount}.pdf`);
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

  const handleSPCopy = async (type: 'fba' | 'depo') => {
    const text = type === 'fba' ? spExportData.fba.tsv : spExportData.depo.tsv;
    await navigator.clipboard.writeText(text);
    setSpCopied(type);
    setTimeout(() => setSpCopied(null), 2000);
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
          {!isActive && isSea && boxes.length > 0 && role === 'admin' && (
            <button onClick={() => setShowSPExport(true)}
              className="px-3 py-2 bg-cyan-600 text-white text-sm rounded-lg hover:bg-cyan-700 flex items-center gap-2">
              <Ship className="w-4 h-4" /> StockPulse
            </button>
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
                    {!isSea ? (
                      <>
                        <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Talep</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Gönderilen</th>
                      </>
                    ) : (
                      <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                    )}
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
                        }}
                        onPrintLabel={handlePrintItemLabel}
                        sendQty={!isSea ? (sendQtyOverrides[item.id] ?? item.quantity) : undefined}
                        onSendQtyChange={!isSea ? (qty) => setSendQtyOverrides(prev => ({ ...prev, [item.id]: qty })) : undefined} />
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
            {canEdit && boxes.length > 0 && (
              <button onClick={handleExportShipmate} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
                <Download className="w-4 h-4" /> Shipmate İndir
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
                        <td className="px-3 py-3 font-mono text-sm text-gray-600">
                          <span className="inline-flex items-center gap-1">
                            {box.fnsku || '—'}
                            {canBoxes && box.fnsku && (
                              <button
                                onClick={() => handleSyncFnsku(box.id)}
                                disabled={syncingFnskuBoxId === box.id}
                                className="text-gray-300 hover:text-blue-500 transition-colors"
                                title="FNSKU güncelle (sku_master'dan)">
                                <RefreshCw className={`w-3 h-3 ${syncingFnskuBoxId === box.id ? 'animate-spin text-blue-500' : ''}`} />
                              </button>
                            )}
                          </span>
                        </td>
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
                    {exitItems.slice(exitPage * 10, (exitPage + 1) * 10).map(item => (
                      <tr key={item.iwasku}>
                        <td className="px-4 py-2 font-mono text-sm">{item.iwasku}</td>
                        <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[200px]">{item.name}</td>
                        <td className="px-4 py-2 text-sm font-semibold text-right">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {exitItems.length > 10 && (
                <div className="flex items-center justify-between">
                  <button onClick={() => setExitPage(p => Math.max(0, p - 1))} disabled={exitPage === 0}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-30">Önceki</button>
                  <span className="text-xs text-gray-500">{exitPage + 1} / {Math.ceil(exitItems.length / 10)}</span>
                  <button onClick={() => setExitPage(p => Math.min(Math.ceil(exitItems.length / 10) - 1, p + 1))} disabled={exitPage >= Math.ceil(exitItems.length / 10) - 1}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-30">Sonraki</button>
                </div>
              )}
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

      {/* === STOCKPULSE EXPORT MODALI === */}
      {showSPExport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">StockPulse Aktarımı</h3>
              <button onClick={() => setShowSPExport(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-4 space-y-5">
              <p className="text-xs text-gray-500">
                Sevkiyat: <span className="font-semibold text-gray-800">{shipment.name}</span> — Koli verilerinden FBA ve Depo olarak ayrıştırıldı.
                StockPulse → In Transit → Yeni Sevkiyat → Yapıştır
              </p>

              {/* FBA Section */}
              {spExportData.fba.items.size > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-cyan-100 text-cyan-800 text-xs font-semibold rounded">FBA-US</span>
                      <span className="text-xs text-gray-500">{spExportData.fba.items.size} SKU · {spExportData.fba.total.toLocaleString('tr-TR')} adet</span>
                    </div>
                    <button onClick={() => handleSPCopy('fba')}
                      className="flex items-center gap-1 px-3 py-1 text-xs border rounded-lg hover:bg-gray-50 transition-colors">
                      {spCopied === 'fba' ? <><Check className="w-3 h-3 text-green-600" /> Kopyalandı</> : <><Copy className="w-3 h-3" /> Kopyala</>}
                    </button>
                  </div>
                  <textarea readOnly value={spExportData.fba.tsv} rows={Math.min(6, spExportData.fba.items.size)}
                    className="w-full px-3 py-2 border rounded-lg text-xs font-mono bg-gray-50 resize-none focus:outline-none" />
                </div>
              )}

              {/* DEPO Section */}
              {spExportData.depo.items.size > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-semibold rounded">NJ</span>
                      <span className="text-xs text-gray-500">{spExportData.depo.items.size} SKU · {spExportData.depo.total.toLocaleString('tr-TR')} adet</span>
                    </div>
                    <button onClick={() => handleSPCopy('depo')}
                      className="flex items-center gap-1 px-3 py-1 text-xs border rounded-lg hover:bg-gray-50 transition-colors">
                      {spCopied === 'depo' ? <><Check className="w-3 h-3 text-green-600" /> Kopyalandı</> : <><Copy className="w-3 h-3" /> Kopyala</>}
                    </button>
                  </div>
                  <textarea readOnly value={spExportData.depo.tsv} rows={Math.min(6, spExportData.depo.items.size)}
                    className="w-full px-3 py-2 border rounded-lg text-xs font-mono bg-gray-50 resize-none focus:outline-none" />
                </div>
              )}

              {spExportData.fba.items.size === 0 && spExportData.depo.items.size === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">Koli verisi bulunamadı</p>
              )}
            </div>
            <div className="flex items-center justify-end px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
              <button onClick={() => setShowSPExport(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Kapat</button>
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
  onTogglePacked, onToggleSelect, onToggleExpand, onCreateBox, onDeleteBox, onDeleteItem, onFnskuSaved,
  onPrintLabel, sendQty, onSendQtyChange }: {
  item: ShipmentItem; itemDesi: number; itemBoxes: ShipmentBox[];
  isSea: boolean; isActive: boolean; isExpanded: boolean; isSelected: boolean; togglingId: string | null;
  canBoxes: boolean; canPack: boolean; canSend: boolean; canDelete: boolean;
  onTogglePacked: () => void; onToggleSelect: () => void; onToggleExpand: () => void;
  onCreateBox: (form: BoxFormData) => Promise<ShipmentBox | null>; onDeleteBox: (boxId: string) => void;
  onDeleteItem: () => void;
  onFnskuSaved: (itemId: string, fnsku: string) => void;
  onPrintLabel: (item: ShipmentItem, count: number) => void;
  sendQty?: number; onSendQtyChange?: (qty: number) => void;
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
        {!isSea && onSendQtyChange ? (
          <>
            <td className={`text-center px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-500'}`}>{item.quantity}</td>
            <td className="text-center px-3 py-3">
              <input
                type="number"
                min={1}
                max={item.quantity}
                value={sendQty ?? item.quantity}
                onChange={e => {
                  const val = Math.min(item.quantity, Math.max(1, parseInt(e.target.value) || 1));
                  onSendQtyChange(val);
                }}
                className="w-16 px-2 py-1 text-sm text-center border rounded focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
            </td>
          </>
        ) : (
          <td className={`text-center px-3 py-3 font-semibold ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.quantity}</td>
        )}
        <td className={`text-center px-3 py-3 font-medium ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{itemDesi > 0 ? Math.round(itemDesi).toLocaleString('tr-TR') : '—'}</td>
        {isActive && (
          <td className="px-2 py-3 text-center">
            <div className="flex items-center gap-1 justify-center">
              {!isSea && (item.fnsku || item.iwasku) && (
                <button onClick={() => {
                  const input = prompt(`${item.iwasku} — Kaç etiket basılsın?`, String(item.quantity));
                  if (input) { const n = parseInt(input); if (n > 0) onPrintLabel(item, n); }
                }} className="text-gray-300 hover:text-blue-600 transition-colors" title="Etiket yazdır">
                  <Printer className="w-4 h-4" />
                </button>
              )}
              {canDelete && (
                <button onClick={onDeleteItem} className="text-red-300 hover:text-red-600 transition-colors" title="Sevkiyattan çıkar"><X className="w-4 h-4" /></button>
              )}
            </div>
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
