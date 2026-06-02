/**
 * Shipment Detail Page
 * 3 tabs: Bekleyen (pending) | Gönderilenler (sent) | Koliler (boxes, sea only)
 * Sea: box entry + sevkiyat kapat
 * Road/air: checkbox + parti gonderi
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { ExitItemsModal } from '@/components/shipments/ExitItemsModal';
import { SPExportModal } from '@/components/shipments/SPExportModal';
import { EditShipmentForm } from '@/components/shipments/EditShipmentForm';
import { AddItemForm } from '@/components/shipments/AddItemForm';
import { PoolItemsModal } from '@/components/shipments/PoolItemsModal';
import { MissingFnskuWarning } from '@/components/shipments/MissingFnskuWarning';
import { PendingItemsTable } from '@/components/shipments/PendingItemsTable';
import { SentItemsTab } from '@/components/shipments/SentItemsTab';
import { BoxesTab } from '@/components/shipments/BoxesTab';
import { useShipmentFilters } from '@/lib/shipments/useShipmentFilters';
import { DateMultiFilter } from '@/components/shipments/DateMultiFilter';
import { useModalToggles } from '@/lib/shipments/useModalToggles';
import type { BoxFormData, ShipmentItem, ShipmentBox } from '@/lib/shipments/types';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Plus, Send, Loader2, AlertCircle, Pencil,
  Calendar, Anchor, Truck as TruckIcon, Plane,
  Download, Ship, X, Search, Trash2,
} from 'lucide-react';

// --- Types ---
// ShipmentItem + ShipmentBox interface'leri lib/shipments/types.ts'e taşındı
interface ShipmentDetail {
  id: string; name: string; destinationTab: string; shippingMethod: string;
  plannedDate: string; actualDate: string | null; etaDate: string | null;
  status: string; notes: string | null; items: ShipmentItem[];
}
// BoxFormData lib/shipments/types.ts'e taşındı (ExtraBoxForm ile paylaşılır)

const methodIcons: Record<string, typeof Anchor> = { sea: Anchor, road: TruckIcon, air: Plane };
const methodLabels: Record<string, string> = { sea: 'Deniz', road: 'Karayolu', air: 'Hava' };
const BOX_ENTRY_METHODS = new Set(['sea']);
const loadXLSX = () => import('xlsx');
const logger = createLogger('ShipmentDetailPage');


export default function ShipmentDetailPage() {
  const { role, isSuperAdmin } = useAuth(); // Session check
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [boxes, setBoxes] = useState<ShipmentBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'sent' | 'boxes'>('pending');
  const [addForm, setAddForm] = useState({ iwasku: '', quantity: '', marketplaceId: '' });
  const [allMarketplaces, setAllMarketplaces] = useState<{ id: string; name: string; code: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSentIds, setSelectedSentIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [unsending, setUnsending] = useState(false);
  const [selectedBoxIds, setSelectedBoxIds] = useState<Set<string>>(new Set());
  const [settingDest, setSettingDest] = useState(false);
  const [bulkFbaText, setBulkFbaText] = useState('');
  const [bulkFbaResult, setBulkFbaResult] = useState<{ updated: number; notFound?: string[] } | null>(null);

  // Search & filter states (custom hook — 10 state)
  const {
    itemSearch, setItemSearch,
    itemCategoryFilter, setItemCategoryFilter,
    itemMarketFilter, setItemMarketFilter,
    itemDateFilter, setItemDateFilter,
    boxSearch, setBoxSearch,
    boxCategoryFilter, setBoxCategoryFilter,
    boxDestFilter, setBoxDestFilter,
    boxMarketFilter, setBoxMarketFilter,
    sentSearch, setSentSearch,
    sentCategoryFilter, setSentCategoryFilter,
    sentMarketFilter, setSentMarketFilter,
    sentDateFilter, setSentDateFilter,
  } = useShipmentFilters();

  // Modal/panel toggles (custom hook — 6 state)
  const {
    showAddItem, setShowAddItem,
    showExtraBox, setShowExtraBox,
    showBulkFba, setShowBulkFba,
    showExitModal, setShowExitModal,
    showSPExport, setShowSPExport,
    editing, setEditing,
  } = useModalToggles();
  const [showPoolModal, setShowPoolModal] = useState(false);

  // Track printed box IDs (DB'den başlat)
  const printedBoxIds = useMemo(() => new Set(boxes.filter(b => b.labelPrinted).map(b => b.id)), [boxes]);
  // Editable cell tab navigation
  const [editingCell, setEditingCell] = useState<{ boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null>(null);

  // Depo çıkış onay modalı (showExitModal hook'tan geliyor)
  const [exitItems, setExitItems] = useState<{ iwasku: string; name: string; quantity: number }[]>([]);
  const [exitWeek, setExitWeek] = useState('');
  const [exitSaving, setExitSaving] = useState(false);
  const [exitPage, setExitPage] = useState(0);
  // Karayolu/hava: Bekleyen tabında gönderilecek miktar override
  const [sendQtyOverrides, setSendQtyOverrides] = useState<Record<string, number>>({});
  // StockPulse export (showSPExport hook'tan geliyor)
  const [spCopied, setSpCopied] = useState<'fba' | 'depo' | null>(null);

  // Permissions from API
  const [perms, setPerms] = useState<Record<string, boolean>>({});

  // FNSKU sync state
  const [syncingFnskuBoxId, setSyncingFnskuBoxId] = useState<string | null>(null);

  // Edit mode (editing hook'tan geliyor)
  const [editForm, setEditForm] = useState({ name: '', plannedDate: '', etaDate: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const fetchShipment = useCallback(async () => {
    try {
      const res = await fetch(`/api/shipments/${id}`);
      const data = await res.json();
      if (data.success) { setShipment(data.data); if (data.meta?.permissions) setPerms(data.meta.permissions); }
    } catch (err) {
      logger.error('fetchShipment failed', err);
      notify.error('Sevkiyat yüklenemedi');
    } finally { setLoading(false); }
  }, [id]);

  const fetchBoxes = useCallback(async () => {
    try {
      const res = await fetch(`/api/shipments/${id}/boxes`);
      const data = await res.json();
      if (data.success) setBoxes(data.data);
    } catch (err) {
      logger.error('fetchBoxes failed', err);
      notify.error('Koli listesi yüklenemedi');
    }
  }, [id]);

  useEffect(() => { fetchShipment(); fetchBoxes(); }, [fetchShipment, fetchBoxes]);

  // Marketplace listesini çek (ürün ekleme formu için)
  useEffect(() => {
    fetch('/api/marketplaces').then(r => r.json()).then(data => {
      if (data.success) setAllMarketplaces(data.data);
    }).catch(err => logger.error('marketplaces fetch failed', err));
  }, []);

  // Marketplace code → name mapping (koliler tablosu icin) — hook, early return'den once olmali.
  // Hem item marketplace'leri hem global liste (yeni eklenen koliler icin)
  const mktCodeToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of allMarketplaces) {
      if (m.code && m.name) map.set(m.code, m.name);
    }
    if (shipment) {
      for (const item of shipment.items) {
        if (item.marketplace?.code && item.marketplace.name) {
          map.set(item.marketplace.code, item.marketplace.name);
        }
      }
    }
    return map;
  }, [shipment, allMarketplaces]);

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
    if (itemDateFilter.size > 0) result = result.filter(i => itemDateFilter.has(i.createdAt.slice(0, 10)));
    return result;
  }, [shipment, itemSearch, itemCategoryFilter, itemMarketFilter, itemDateFilter]);

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
  const itemDates = useMemo(() => [...new Set((shipment?.items.filter(i => !i.sentAt) ?? []).map(i => i.createdAt.slice(0, 10)))].sort().reverse(), [shipment]);
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
    if (sentDateFilter.size > 0) result = result.filter(i => sentDateFilter.has(i.createdAt.slice(0, 10)));
    return result;
  }, [shipment, sentSearch, sentCategoryFilter, sentMarketFilter, sentDateFilter]);
  const sentCategories = useMemo(() => [...new Set((shipment?.items.filter(i => i.sentAt) ?? []).map(i => i.productCategory).filter(Boolean))].sort(), [shipment]);
  const sentMarkets = useMemo(() => [...new Set((shipment?.items.filter(i => i.sentAt) ?? []).map(i => i.marketplace?.code).filter(Boolean) as string[])].sort(), [shipment]);
  const sentDates = useMemo(() => [...new Set((shipment?.items.filter(i => i.sentAt) ?? []).map(i => i.createdAt.slice(0, 10)))].sort().reverse(), [shipment]);

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
      else notify.error(data.error);
    } catch { notify.error('Kaydetme hatası'); } finally { setSaving(false); }
  };

  // --- Handlers ---
  const handleTogglePacked = async (itemId: string) => {
    setTogglingId(itemId);
    try {
      const res = await fetch(`/api/shipments/${id}/items/${itemId}`, { method: 'PATCH' });
      const data = await res.json();
      if (data.success) setShipment(prev => prev ? { ...prev, items: prev.items.map(i => i.id === itemId ? { ...i, packed: data.data.packed } : i) } : prev);
      else notify.error(data.error || 'Hazırla işlemi başarısız');
    } catch (err) {
      logger.error('togglePacked failed', err);
      notify.error('Hazırla işlemi başarısız');
    } finally { setTogglingId(null); }
  };

  const handleToggleSelect = (itemId: string) => {
    const next = new Set(selectedIds);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    setSelectedIds(next);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!(await confirm({ title: 'Bu ürün sevkiyattan çıkarılsın mı?', variant: 'danger', confirmLabel: 'Çıkar' }))) return;
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
      else notify.error(data.error);
    } catch { notify.error('Çıkış kayıt hatası'); } finally { setExitSaving(false); }
  };

  // Karayolu/hava: seçili packed itemleri gönder (kısmi miktar destekli)
  const handleSendSelected = async () => {
    const toSend = [...selectedIds]
      .map(sid => pendingItems.find(i => i.id === sid))
      .filter((item): item is ShipmentItem => !!item?.packed);
    if (toSend.length === 0) return;
    const missingQty = toSend.filter(item => !sendQtyOverrides[item.id]);
    if (missingQty.length > 0) {
      notify.error(`${missingQty.length} ürün için gönderilecek miktar giriniz`);
      return;
    }
    const sendItems = toSend.map(item => ({
      id: item.id,
      quantity: sendQtyOverrides[item.id],
    }));
    const totalQtySend = sendItems.reduce((s, i) => s + i.quantity, 0);
    if (!(await confirm({ title: `${toSend.length} ürün gönderilsin mi?`, message: `Toplam ${totalQtySend} adet.`, confirmLabel: 'Gönder' }))) return;
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
          quantity: sendQtyOverrides[item.id],
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
      } else notify.error(data.error);
    } catch { notify.error('Gönderim hatası'); } finally { setSending(false); }
  };

  // Gönderilmişleri geri al
  const handleUnsendSelected = async () => {
    const toUnsend = [...selectedSentIds];
    if (toUnsend.length === 0) return;
    if (!(await confirm({ title: `${toUnsend.length} ürünün gönderimi geri alınsın mı?`, variant: 'danger', confirmLabel: 'Geri Al' }))) return;
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
      } else notify.error(data.error);
    } catch { notify.error('Geri alma hatası'); } finally { setUnsending(false); }
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
    if (!(await confirm({ title: 'Sevkiyat kapatılsın mı?', message: 'Tüm ürünler gönderilmiş olarak işaretlenecek.', confirmLabel: 'Kapat' }))) return;
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
      } else notify.error(data.error);
    } catch { notify.error('Kapama hatası'); } finally { setSending(false); }
  };

  const handleDeleteShipment = async () => {
    if (!shipment) return;
    const confirmed = await confirm({
      title: 'Sevkiyat silinsin mi?',
      message: `${shipment.name} kalıcı olarak silinecek. İçindeki tüm koliler ve item'lar da silinir. Talepler "yönlendirilmemiş" durumuna döner ve başka sevkiyata atanabilir. Bu işlem geri alınamaz.`,
      confirmLabel: 'Sil',
    });
    if (!confirmed) return;
    setSending(true);
    try {
      const res = await fetch(`/api/shipments/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        notify.success(`${data.data.shipmentName} silindi`);
        router.push('/dashboard/shipments');
      } else {
        notify.error(data.error || 'Silinemedi');
      }
    } catch {
      notify.error('Silme hatası');
    } finally {
      setSending(false);
    }
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
      else notify.error(data.error);
    } catch { notify.error('Hata'); } finally { setAdding(false); }
  };

  const handleCreateBox = async (form: BoxFormData, shipmentItemId: string | null) => {
    const res = await fetch(`/api/shipments/${id}/boxes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, shipmentItemId }),
    });
    const data = await res.json();
    if (data.success) { await Promise.all([fetchBoxes(), fetchShipment()]); return data.data as ShipmentBox; }
    else { notify.error(data.error); return null; }
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
    if (!(await confirm({ title: 'Bu koli silinsin mi?', variant: 'danger', confirmLabel: 'Sil' }))) return;
    const res = await fetch(`/api/shipments/${id}/boxes?boxId=${boxId}`, { method: 'DELETE' });
    if ((await res.json()).success) await Promise.all([fetchBoxes(), fetchShipment()]);
  };

  const handleSetDestination = async (destination: 'FBA' | 'DEPO' | 'SHOWROOM') => {
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
      } else notify.error(data.error || 'Hedef ayarlanamadı');
    } catch (err) {
      logger.error('setDestination failed', err);
      notify.error('Hedef ayarlanamadı');
    } finally { setSettingDest(false); }
  };

  const handleBulkFbaSubmit = async (dest: 'FBA' | 'DEPO' | 'SHOWROOM') => {
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
      } else notify.error(data.error || 'Toplu işaretleme başarısız');
    } catch (err) {
      logger.error('bulkFbaSubmit failed', err);
      notify.error('Toplu işaretleme başarısız');
    } finally { setSettingDest(false); }
  };

  const handleToggleBoxSelect = (boxId: string) => {
    const next = new Set(selectedBoxIds);
    if (next.has(boxId)) next.delete(boxId); else next.add(boxId);
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
    if (usBoxes.length === 0) return notify.error('Amazon US pazar yerine ait FNSKU\'lu koli bulunamadı.');
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

      // EU asset'leri yalnızca EU print akışında dynamic load — ~24KB base64
      // page bundle'a girmesin
      const [gpsrLogo, gpsrEurp, gpsrSymbols] = isEU
        ? await (async () => {
            const { GPSR_LOGO_B64, GPSR_EURP_B64, GPSR_SYMBOLS_B64 } = await import('@/lib/labels/gpsr-assets');
            return Promise.all([preloadImage(GPSR_LOGO_B64), preloadImage(GPSR_EURP_B64), preloadImage(GPSR_SYMBOLS_B64)]);
          })()
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
    // DB'de labelPrinted işaretle (PDF zaten yazıldı, bu başarısız olsa da
    // kullanıcı için kritik değil — sadece log)
    try {
      await fetch(`/api/shipments/${id}/boxes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId: box.id, labelPrinted: true }),
      });
      fetchBoxes();
    } catch (err) {
      logger.error('labelPrinted update failed (PDF zaten basıldı)', err);
    }
  };

  const handleFnskuSaved = (itemId: string, fnsku: string) => {
    setShipment(prev => prev ? {
      ...prev,
      items: prev.items.map(i => i.id === itemId ? { ...i, fnsku } : i),
    } : prev);
  };

  const handleSendQtyChange = (itemId: string, qty: number) => {
    setSendQtyOverrides(prev => ({ ...prev, [itemId]: qty }));
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

    // EU asset'leri yalnızca EU print akışında dynamic load
    const [gpsrLogo, gpsrEurp, gpsrSymbols] = isEU
      ? await (async () => {
          const { GPSR_LOGO_B64, GPSR_EURP_B64, GPSR_SYMBOLS_B64 } = await import('@/lib/labels/gpsr-assets');
          return Promise.all([preloadImage(GPSR_LOGO_B64), preloadImage(GPSR_EURP_B64), preloadImage(GPSR_SYMBOLS_B64)]);
        })()
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
      const data = await res.json();
      if (data.success) fetchBoxes();
      else notify.error(data.error || 'Ölçü kopyalanamadı');
    } catch (err) {
      logger.error('copyDimensions failed', err);
      notify.error('Ölçü kopyalanamadı');
    }
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
              if (!(await confirm({ title: 'Teslim edildi?', message: 'Sevkiyat DELIVERED durumuna geçecek.', confirmLabel: 'Teslim Edildi' }))) return;
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
          {isSuperAdmin && (shipment.status === 'PLANNING' || shipment.status === 'LOADING') && (
            <button onClick={handleDeleteShipment} disabled={sending}
              className="px-3 py-2 bg-red-50 text-red-700 border border-red-200 text-sm rounded-lg hover:bg-red-100 disabled:opacity-50 flex items-center gap-2"
              title="Sevkiyatı sil (super-admin)">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Sevkiyatı Sil
            </button>
          )}
        </div>
      </div>

      {editing && (
        <EditShipmentForm
          form={editForm}
          saving={saving}
          onChange={setEditForm}
          onSave={handleSaveEdit}
          onCancel={() => setEditing(false)}
        />
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

      <MissingFnskuWarning
        items={pendingItems.filter(i => !i.fnsku && i.marketplace?.code?.startsWith('AMZN'))}
      />


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
            {isActive && canRoute && (
              <button onClick={() => setShowPoolModal(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700">
                <Plus className="w-4 h-4" /> Havuzdan Ekle
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
                    {itemMarkets.map(m => <option key={m} value={m}>{mktCodeToName.get(m) || m}</option>)}
                  </select>
                )}
                <DateMultiFilter dates={itemDates} selected={itemDateFilter} onChange={setItemDateFilter} />
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
            <AddItemForm
              form={addForm}
              marketplaces={allMarketplaces}
              adding={adding}
              onChange={setAddForm}
              onSubmit={handleAddItem}
            />
          )}

          {showPoolModal && shipment && (
            <PoolItemsModal
              shipmentId={shipment.id}
              shipmentName={shipment.name}
              country={shipment.destinationTab}
              onClose={() => setShowPoolModal(false)}
              onSuccess={() => { setShowPoolModal(false); fetchShipment(); }}
            />
          )}

          <PendingItemsTable
            items={filteredPendingItems}
            boxes={boxes}
            hasAnyPending={pendingItems.length > 0}
            isSea={isSea}
            isActive={isActive}
            canBoxes={canBoxes}
            canPack={canPack}
            canSend={canSend}
            canDelete={canDelete}
            expandedItemId={expandedItemId}
            selectedIds={selectedIds}
            togglingId={togglingId}
            packedPendingCount={packedPendingCount}
            sendQtyOverrides={sendQtyOverrides}
            onSelectAllPacked={handleSelectAllPacked}
            onTogglePacked={handleTogglePacked}
            onToggleSelect={handleToggleSelect}
            onSetExpandedItemId={setExpandedItemId}
            onCreateBox={handleCreateBox}
            onDeleteBox={handleDeleteBox}
            onDeleteItem={handleDeleteItem}
            onFnskuSaved={handleFnskuSaved}
            onPrintLabel={handlePrintItemLabel}
            onSendQtyChange={handleSendQtyChange}
          />
        </div>
      )}

      {activeTab === 'sent' && (
        <SentItemsTab
          items={filteredSentItems}
          hasAnySent={sentItems.length > 0}
          totalSentCount={sentItems.length}
          search={sentSearch}
          categoryFilter={sentCategoryFilter}
          marketFilter={sentMarketFilter}
          dateFilter={sentDateFilter}
          categories={sentCategories}
          markets={sentMarkets}
          dates={sentDates}
          selectedSentIds={selectedSentIds}
          canSend={canSend}
          canUnsend={canUnsend}
          unsending={unsending}
          mktCodeToName={mktCodeToName}
          onSearchChange={setSentSearch}
          onCategoryFilterChange={setSentCategoryFilter}
          onMarketFilterChange={setSentMarketFilter}
          onDateFilterChange={setSentDateFilter}
          onSelectionChange={setSelectedSentIds}
          onExitForSent={handleExitForSent}
          onUnsendSelected={handleUnsendSelected}
        />
      )}

      {/* === BOXES TAB === */}
      {activeTab === 'boxes' && isSea && (
        <BoxesTab
          shipmentId={id}
          boxes={boxes}
          filteredBoxes={filteredBoxes}
          isActive={isActive}
          canBoxes={canBoxes}
          canDest={canDest}
          canEdit={canEdit}
          showExtraBox={showExtraBox}
          showBulkFba={showBulkFba}
          bulkFbaText={bulkFbaText}
          bulkFbaResult={bulkFbaResult}
          settingDest={settingDest}
          search={boxSearch}
          categoryFilter={boxCategoryFilter}
          destFilter={boxDestFilter}
          marketFilter={boxMarketFilter}
          categories={boxCategories}
          markets={boxMarkets}
          selectedBoxIds={selectedBoxIds}
          syncingFnskuBoxId={syncingFnskuBoxId}
          editingCell={editingCell}
          printedBoxIds={printedBoxIds}
          mktCodeToName={mktCodeToName}
          donorMap={donorMap}
          marketplaces={allMarketplaces}
          onSearchChange={setBoxSearch}
          onCategoryFilterChange={setBoxCategoryFilter}
          onDestFilterChange={setBoxDestFilter}
          onMarketFilterChange={setBoxMarketFilter}
          onToggleExtraBox={() => setShowExtraBox(!showExtraBox)}
          onToggleBulkFba={() => setShowBulkFba(!showBulkFba)}
          onBulkFbaTextChange={setBulkFbaText}
          onBulkFbaSubmit={handleBulkFbaSubmit}
          onCloseBulkFba={() => { setShowBulkFba(false); setBulkFbaResult(null); }}
          onExportBoxes={handleExportBoxes}
          onExportShipmate={handleExportShipmate}
          onSelectAllBoxes={handleSelectAllBoxes}
          onToggleBoxSelect={handleToggleBoxSelect}
          onSetDestination={handleSetDestination}
          onCreateBox={handleCreateBox}
          onCloseExtraBox={() => setShowExtraBox(false)}
          onSyncFnsku={handleSyncFnsku}
          onCopyDimensions={handleCopyDimensions}
          onPrintBoxLabel={handlePrintBoxLabel}
          onDeleteBox={handleDeleteBox}
          onEditingCellChange={setEditingCell}
          onBoxUpdated={fetchBoxes}
        />
      )}

      {/* === DEPO ÇIKIŞ ONAY MODALI === */}
      {showExitModal && (
        <ExitItemsModal
          items={exitItems}
          week={exitWeek}
          saving={exitSaving}
          page={exitPage}
          onWeekChange={setExitWeek}
          onPageChange={setExitPage}
          onClose={() => setShowExitModal(false)}
          onConfirm={handleConfirmExit}
        />
      )}

      {/* === STOCKPULSE EXPORT MODALI === */}
      {showSPExport && (
        <SPExportModal
          shipmentName={shipment.name}
          fba={{ count: spExportData.fba.items.size, total: spExportData.fba.total, tsv: spExportData.fba.tsv }}
          depo={{ count: spExportData.depo.items.size, total: spExportData.depo.total, tsv: spExportData.depo.tsv }}
          copied={spCopied}
          onClose={() => setShowSPExport(false)}
          onCopy={handleSPCopy}
        />
      )}
    </div>
  );
}


