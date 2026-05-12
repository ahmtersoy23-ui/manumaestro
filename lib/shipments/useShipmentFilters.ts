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

  // Boxes tab
  const [boxSearch, setBoxSearch] = useState('');
  const [boxCategoryFilter, setBoxCategoryFilter] = useState('');
  const [boxDestFilter, setBoxDestFilter] = useState('');
  const [boxMarketFilter, setBoxMarketFilter] = useState('');

  // Sent tab
  const [sentSearch, setSentSearch] = useState('');
  const [sentCategoryFilter, setSentCategoryFilter] = useState('');
  const [sentMarketFilter, setSentMarketFilter] = useState('');

  return {
    itemSearch, setItemSearch,
    itemCategoryFilter, setItemCategoryFilter,
    itemMarketFilter, setItemMarketFilter,
    boxSearch, setBoxSearch,
    boxCategoryFilter, setBoxCategoryFilter,
    boxDestFilter, setBoxDestFilter,
    boxMarketFilter, setBoxMarketFilter,
    sentSearch, setSentSearch,
    sentCategoryFilter, setSentCategoryFilter,
    sentMarketFilter, setSentMarketFilter,
  };
}
