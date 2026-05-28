/**
 * V2 sayfası bölge × iki barem yapısı.
 *
 * Üst tab: bölge (US/UK/EU/OTHER)
 * 1. barem (destination): üretim emri buralarda — operatör kabul/red verir, ProductionRequest oluşur
 * 2. barem (channel detail): sadece satış görünürlüğü — üretim emri YOK, görsel/analiz
 *
 * StockPulse'taki bölge × tab ayrımı ile birebir uyumlu.
 */

export type Region = 'US' | 'UK' | 'EU' | 'OTHER';
export const REGIONS: Region[] = ['US', 'UK', 'EU', 'OTHER'];

export const REGION_LABELS: Record<Region, string> = {
  US: 'ABD',
  UK: 'Birleşik Krallık',
  EU: 'Avrupa',
  OTHER: 'Diğer',
};

/** 1. barem — Üretim emri verilen marketplace code'ları (her bölge için sıralı). */
export const DESTINATIONS_BY_REGION: Record<Region, string[]> = {
  US: ['AMZN_US', 'NJ_DEPO', 'WAYFAIR_US'],
  UK: ['AMZN_UK', 'UK_DEPO', 'WAYFAIR_UK'],
  EU: ['AMZN_EU', 'EU_NL_DEPO'],
  OTHER: ['AMZN_CA', 'AMZN_AU', 'TAKEALOT_ZA', 'CUSTOM_06', 'SEZON'],
};

/**
 * Destinasyon kartlarında gösterilecek "gideceği yer" bazlı etiketler.
 * Marketplace.name (DB) genel kullanım için, bu etiket sevkiyat hedefini vurgular.
 */
export const DESTINATION_LABELS: Record<string, string> = {
  AMZN_US: 'US FBA',
  AMZN_UK: 'UK FBA',
  AMZN_EU: 'EU FBA',
  AMZN_CA: 'CA FBA',
  AMZN_AU: 'AU FBA',
  WAYFAIR_US: 'US CG Depo (Wayfair)',
  WAYFAIR_UK: 'UK Wayfair',
  NJ_DEPO: 'US NJ Depo',
  UK_DEPO: 'UK Depo',
  EU_NL_DEPO: 'EU NL Depo',
  TAKEALOT_ZA: 'ZA Takealot',
  CUSTOM_06: 'TR Trendyol',
  SEZON: 'TR Sezon',
};

export function destinationLabel(code: string, fallback?: string): string {
  return DESTINATION_LABELS[code] ?? fallback ?? code;
}

/**
 * 2. barem — Destinasyon altında satış görünürlüğü kanalları.
 * Boş array → bu destinasyon kendi başına satış sinyali, alt detay yok.
 */
export const DETAIL_CHANNELS_BY_DESTINATION: Record<string, string[]> = {
  AMZN_US: [],
  NJ_DEPO: ['CUSTOM_01', 'CUSTOM_03', 'CUSTOM_05', 'CUSTOM_07'], // Citi, Etsy, Walmart, Shopify
  WAYFAIR_US: [],
  AMZN_UK: [],
  UK_DEPO: ['CUSTOM_04'], // Ebay
  WAYFAIR_UK: [],
  AMZN_EU: [],
  EU_NL_DEPO: ['BOL_NL', 'CUSTOM_02'], // Bol, Kaufland
  AMZN_CA: [],
  AMZN_AU: [],
  TAKEALOT_ZA: [],
  CUSTOM_06: [], // Trendyol
  SEZON: [],
};

/** Marketplace code → ana Destinasyon code resolve.
 *  - Eğer code 1. barem (destinasyon) ise: kendisi döner
 *  - Eğer code 2. barem (detay kanal) ise: bağlı olduğu destinasyon döner
 *  - Bilinmeyen: null
 */
export function destinationForMarketplace(code: string): string | null {
  for (const region of REGIONS) {
    if (DESTINATIONS_BY_REGION[region].includes(code)) return code;
  }
  for (const [dest, details] of Object.entries(DETAIL_CHANNELS_BY_DESTINATION)) {
    if (details.includes(code)) return dest;
  }
  return null;
}

/** Marketplace code → Region resolve. Bilinmeyen → null. */
export function regionForMarketplace(code: string): Region | null {
  for (const region of REGIONS) {
    if (DESTINATIONS_BY_REGION[region].includes(code)) return region;
  }
  // Detay kanallardan ana destinasyona → bölgeye
  for (const [dest, details] of Object.entries(DETAIL_CHANNELS_BY_DESTINATION)) {
    if (details.includes(code)) {
      return regionForMarketplace(dest);
    }
  }
  return null;
}

/**
 * Region için ülke bazlı stok kaynak warehouse code'ları.
 * pricelab.fba_inventory.warehouse field değerleri.
 */
export const FBA_WAREHOUSES_BY_REGION: Record<Region, string[]> = {
  US: ['US', 'WFS', 'WFM'], // FBA US + Wayfair Castle Gate (CG)
  UK: ['UK'],
  EU: ['EU'],
  OTHER: ['CA', 'AU'],
};

/**
 * Region için manumaestro Shipments.destination kodları (in-transit hesabı için).
 * Sadece arrived_at IS NULL olan shipment'lar in-transit sayılır.
 */
export const TRANSIT_DESTINATIONS_BY_REGION: Record<Region, string[]> = {
  US: ['NJ', 'US'], // NJ depo'ya gönderim + (varsa direkt FBA destination)
  UK: ['UK'],
  EU: ['EU'],
  OTHER: [],
};
