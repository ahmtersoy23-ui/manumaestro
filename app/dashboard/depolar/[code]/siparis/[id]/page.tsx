/**
 * Sipariş Detay Sayfası — ürünler + Çıkış Yap + İptal aksiyonları.
 */

'use client';

import { useEffect, useState, use } from 'react';
import { notify } from '@/lib/ui/notify';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import Link from 'next/link';
import { ChevronLeft, AlertCircle, Truck, X, PackageOpen, Box as BoxIcon } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { slugToCode, codeToSlug } from '@/lib/warehouseLabels';
import { SingleOrderItemAdder } from '@/components/wms/SingleOrderItemAdder';
import { FbaPickupBoxSelector } from '@/components/wms/FbaPickupBoxSelector';
import { LabelUploader } from '@/components/wms/LabelUploader';
import { ShipModal } from '@/components/wms/ShipModal';

const logger = createLogger('SiparisDetay');

interface Item {
  id: string;
  iwasku: string;
  productName: string | null;
  dims: {
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    weightLb: number | null;
  } | null;
  quantity: number;
  shelfId: string | null;
  shelfCode: string | null;
  shelfBoxId: string | null;
  boxNumber: string | null;
  boxStatus: string | null;
}
interface OrderData {
  role: string;
  order: {
    id: string;
    orderType: 'SINGLE' | 'FBA_PICKUP';
    marketplaceCode: string;
    orderNumber: string;
    description: string | null;
    addressNote: string | null;
    status: 'DRAFT' | 'SHIPPED' | 'CANCELLED';
    createdAt: string;
    shippedAt: string | null;
  };
  items: Item[];
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  SHIPPED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export default function SiparisDetayPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code: rawCode, id } = use(params);
  const code = slugToCode(rawCode) ?? rawCode.toUpperCase();
  const confirm = useConfirm();

  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [shipModalOpen, setShipModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}/siparis/${id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d.data);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Sipariş fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, id, refreshKey]);

  // FBA_PICKUP eski path: items.shelfBoxId pre-set olduğu için tek tıkla ship.
  // SINGLE: ShipModal ile raf seçimi.
  async function shipFbaLegacy() {
    if (!data) return;
    if (!(await confirm({ title: `Sipariş gönderilsin mi?`, message: `${data.items.length} ürün.`, confirmLabel: 'Gönder' }))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${code}/siparis/${id}/ship`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        notify.error(d.error || 'Gönderilemedi');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Ship hatası', e);
      notify.error('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!(await confirm({ title: 'Sipariş iptal edilsin mi?', message: 'Rezerveler serbest bırakılacak.', variant: 'danger', confirmLabel: 'İptal Et' }))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${code}/siparis/${id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        notify.error(d.error || 'İptal başarısız');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Cancel hatası', e);
      notify.error('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  async function revertShip() {
    if (!(await confirm({ title: 'Sevkiyat geri alınsın mı?', message: 'Stok geri yüklenir, sipariş DRAFT olur.', variant: 'danger', confirmLabel: 'Geri Al' })))
      return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${code}/siparis/${id}/revert`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        notify.error(d.error || 'Geri alınamadı');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Revert hatası', e);
      notify.error('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!(await confirm({ title: 'Bu ürün silinsin mi?', message: 'Rezerve serbest bırakılacak.', variant: 'danger', confirmLabel: 'Sil' }))) return;
    try {
      const res = await fetch(`/api/depolar/${code}/siparis/${id}/items?itemId=${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        notify.error(d.error || 'Silinemedi');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Remove item hatası', e);
      notify.error('Sunucu hatası');
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  if (!data) return null;

  const canShip = ['PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(data.role) && data.order.status === 'DRAFT' && data.items.length > 0;
  const canCancel = ['PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(data.role) && data.order.status === 'DRAFT';
  const canRevert = data.role === 'ADMIN' && data.order.status === 'SHIPPED';
  const totalQty = data.items.reduce((s, x) => s + x.quantity, 0);

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/depolar/${codeToSlug(code)}/siparis`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sipariş Çıkış
      </Link>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                data.order.orderType === 'FBA_PICKUP'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {data.order.orderType === 'FBA_PICKUP' ? 'FBA Pick-up' : 'Tekil Sipariş'}
              </span>
              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${STATUS_BADGE[data.order.status]}`}>
                {data.order.status}
              </span>
            </div>
            <h1 className="text-xl font-bold font-mono text-gray-900">{data.order.orderNumber}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-mono">{data.order.marketplaceCode}</span>
              {' • '}
              {new Date(data.order.createdAt).toLocaleString('tr-TR')}
              {data.order.shippedAt && (
                <> {' • Sevk: '} {new Date(data.order.shippedAt).toLocaleString('tr-TR')}</>
              )}
            </p>
            {data.order.description && (
              <p className="text-sm text-gray-700 mt-2">{data.order.description}</p>
            )}
            {data.order.addressNote && (
              <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-700 whitespace-pre-wrap">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                  Adres / Açıklama
                </div>
                {data.order.addressNote}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {canCancel && (
              <button
                onClick={cancel}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-red-700 bg-red-50 hover:bg-red-100 rounded-md disabled:opacity-50"
              >
                <X className="w-4 h-4" /> İptal
              </button>
            )}
            {canRevert && (
              <button
                onClick={revertShip}
                disabled={submitting}
                title="Sevkiyatı geri al — stok geri yüklenir, DRAFT'a döner (admin)"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Çıkışı Geri Al
              </button>
            )}
            {canShip && (
              data.order.orderType === 'SINGLE' ? (
                <button
                  onClick={() => setShipModalOpen(true)}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
                >
                  <Truck className="w-4 h-4" /> Çıkış Yap ({totalQty})
                </button>
              ) : (
                <button
                  onClick={shipFbaLegacy}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
                >
                  <Truck className="w-4 h-4" /> Onayla & Gönder ({totalQty})
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Etiketler — DRAFT/SHIPPED'de hep görünür, yetkiye göre yükle/bas/sil */}
      <LabelUploader warehouseCode={code} orderId={data.order.id} role={data.role} />

      {/* Kalem ekleme: SINGLE artık girişte oluşur — sadece boş legacy DRAFT'lar
          için adder görünür. FBA_PICKUP eski akış: koliler detayda eklenir. */}
      {data.order.status === 'DRAFT' &&
        ['PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(data.role) &&
        (data.order.orderType === 'SINGLE'
          ? data.items.length === 0 && (
              <SingleOrderItemAdder
                warehouseCode={code}
                orderId={data.order.id}
                onSuccess={() => setRefreshKey((k) => k + 1)}
              />
            )
          : (
            <FbaPickupBoxSelector
              warehouseCode={code}
              orderId={data.order.id}
              onSuccess={() => setRefreshKey((k) => k + 1)}
              alreadyAddedIds={new Set(data.items.map((i) => i.shelfBoxId).filter(Boolean) as string[])}
            />
          ))}

      {/* Ürünler */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Ürünler ({data.items.length})</h2>
          <span className="text-xs text-gray-500">Toplam adet: {totalQty}</span>
        </div>
        {data.items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400 text-center">
            <PackageOpen className="w-6 h-6 mx-auto mb-2 text-gray-300" />
            Henüz ürün yok. Sipariş yaratırken ürün satırı eklenir.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">SKU</th>
                <th className="text-left px-4 py-2">Ürün</th>
                <th className="text-left px-4 py-2">Ölçü (inç/lb)</th>
                <th className="text-left px-4 py-2">Kaynak</th>
                <th className="text-right px-4 py-2">Adet</th>
                {data.order.status === 'DRAFT' && <th className="text-right px-4 py-2 w-20">İşlem</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((item) => (
                <tr key={item.id} className="text-gray-700">
                  <td className="px-4 py-2 font-mono text-xs">{item.iwasku}</td>
                  <td className="px-4 py-2 text-xs truncate max-w-[260px]">{item.productName ?? '—'}</td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap text-gray-600">
                    {item.dims ? (
                      <>
                        {item.dims.lengthIn != null &&
                          item.dims.widthIn != null &&
                          item.dims.heightIn != null && (
                            <span>
                              {item.dims.lengthIn}×{item.dims.widthIn}×{item.dims.heightIn} in
                            </span>
                          )}
                        {item.dims.weightLb != null && (
                          <span className="text-gray-400"> · {item.dims.weightLb} lb</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {item.shelfBoxId ? (
                      <span className="inline-flex items-center gap-1">
                        <BoxIcon className="w-3 h-3 text-gray-400" />
                        <span className="font-mono">{item.boxNumber}</span>
                        <span className="text-gray-400">@ {item.shelfCode}</span>
                      </span>
                    ) : item.shelfCode ? (
                      <span className="font-mono text-gray-700">{item.shelfCode}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{item.quantity}</td>
                  {data.order.status === 'DRAFT' && (
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-[11px] text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded"
                        title="Ürünü sil"
                      >
                        Sil
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Çıkış modal — SINGLE için */}
      <ShipModal
        isOpen={shipModalOpen}
        warehouseCode={code}
        orderId={data.order.id}
        orderNumber={data.order.orderNumber}
        onClose={() => setShipModalOpen(false)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
