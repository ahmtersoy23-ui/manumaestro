/**
 * Eski URL — Ankara depo envanter görünümü.
 * Yeni yer: /dashboard/depolar/ANKARA (Dashboard sekmesi).
 * Aynı bileşen render edilir; bookmark'lar için geri uyumluluk korunuyor.
 */

import WarehouseStockView from '@/components/warehouse/WarehouseStockView';

export default function WarehouseStockPage() {
  return <WarehouseStockView />;
}
