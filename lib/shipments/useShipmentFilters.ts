/**
 * Shipment detail page'deki filter/search state'leri.
 *
 * 3 tab (pending/sent/boxes) için ayrı search + kategori + market/dest
 * filter state'leri. shipments/[id]/page.tsx'in state count'unu düşürmek
 * için flat shape return eder — kullanım yerlerinde isim değişmez.
 */

import { useState } from 'react';

export function useShipmentFilters() {
  // Pending tab
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('');
  const [itemMarketFilter, setItemMarketFilter] = useState('');
  const [itemDateFilter, setItemDateFilter] = useState('');

  // Boxes tab
  const [boxSearch, setBoxSearch] = useState('');
  const [boxCategoryFilter, setBoxCategoryFilter] = useState('');
  const [boxDestFilter, setBoxDestFilter] = useState('');
  const [boxMarketFilter, setBoxMarketFilter] = useState('');

  // Sent tab
  const [sentSearch, setSentSearch] = useState('');
  const [sentCategoryFilter, setSentCategoryFilter] = useState('');
  const [sentMarketFilter, setSentMarketFilter] = useState('');
  const [sentDateFilter, setSentDateFilter] = useState('');

  return {
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
  };
}

/**
 * Preset tarih penceresi: '' (tümü), 'today', '3d', '7d'.
 * Takvim günü esasına göre — "Bugün" bugünün 00:00'ından itibaren.
 */
export function inDateWindow(createdAt: string, filter: string): boolean {
  if (!filter) return true;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const created = new Date(createdAt).getTime();
  if (filter === 'today') return created >= startOfToday;
  const days = filter === '3d' ? 3 : filter === '7d' ? 7 : 0;
  if (!days) return true;
  return created >= startOfToday - (days - 1) * 86400000;
}
