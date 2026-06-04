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

/**
 * Pazar yeri listesi (her bölge için sıralı).
 * Üretim talepleri PR.marketplaceId = pazar yeri (Amazon US, Shopify, Wayfair, vs).
 * Sevkiyat hedefi (US FBA / NJ Depo / CG Depo / vs) PR.recommendedDestination
 * kolonunda; UI'da tablo kolonu olarak gösterilir.
 *
 * Eski destinasyon marketplaces (NJ_DEPO, UK_DEPO, EU_NL_DEPO) artık burada YOK —
 * StockPulse pazar yeri-bazlı sync ile bunlara yazmıyor, sadece eski PR'lar için
 * geriye dönük destek (pipeline endpoint'inde fallback mapping).
 */
export const DESTINATIONS_BY_REGION: Record<Region, string[]> = {
  US: ['AMZN_US', 'CUSTOM_07', 'CUSTOM_05', 'CUSTOM_01', 'CUSTOM_03', 'WAYFAIR_US'],
  UK: ['AMZN_UK', 'WAYFAIR_UK', 'CUSTOM_04'],
  EU: ['AMZN_EU', 'BOL_NL', 'CUSTOM_02'],
  OTHER: ['AMZN_CA', 'AMZN_AU', 'TAKEALOT_ZA', 'CUSTOM_06', 'SEZON'],
};

/**
 * Pazar yeri kartlarında gösterilecek etiket.
 * marketplace.name DB'de kısa (Amazon Citi, Shopify vs.) — UI için yeterli, bu
 * mapping artık sevkiyat hedefini değil pazar yeri adını vurgular.
 */
export const DESTINATION_LABELS: Record<string, string> = {
  AMZN_US: 'Amazon US',
  AMZN_UK: 'Amazon UK',
  AMZN_EU: 'Amazon EU',
  AMZN_CA: 'Amazon CA',
  AMZN_AU: 'Amazon AU',
  WAYFAIR_US: 'Wayfair',
  WAYFAIR_UK: 'Wayfair UK',
  CUSTOM_01: 'Amazon Citi',
  CUSTOM_02: 'Kaufland',
  CUSTOM_03: 'Etsy',
  CUSTOM_04: 'Ebay',
  CUSTOM_05: 'Walmart',
  CUSTOM_06: 'Trendyol',
  CUSTOM_07: 'Shopify',
  BOL_NL: 'Bol',
  TAKEALOT_ZA: 'Takealot',
  SEZON: 'Sezon',
};

/** recommendedDestination → Türkçe gösterim etiketi (sevkiyat hedefi). */
export const SHIPMENT_DESTINATION_LABELS: Record<string, string> = {
  US_FBA: 'US FBA',
  NJ_DEPO: 'NJ Depo',
  CG_DEPO: 'CG Depo',
  UK_FBA: 'UK FBA',
  UK_DEPO: 'UK Depo',
  EU_FBA: 'EU FBA',
  NL_DEPO: 'NL Depo',
  CA_FBA: 'CA FBA',
  AU_FBA: 'AU FBA',
  ZA_TAKEALOT: 'Takealot',
};

/**
 * FBA destinasyonu → Amazon pazaryeri kodu (1:1). Havuzdan eklenen FBA item'ları
 * marketplace'siz geldiğinde bu eşlemeyle marketplaceId set edilir → kolonda
 * "Amazon US" görünür + FNSKU lookup (marketplace.code → ülke) çalışır.
 * Depo destinasyonları (NJ_DEPO/CG_DEPO/NL_DEPO/UK_DEPO) çok-pazaryeri → eşlenmez.
 */
export const FBA_DESTINATION_TO_MARKETPLACE: Record<string, string> = {
  US_FBA: 'AMZN_US',
  UK_FBA: 'AMZN_UK',
  EU_FBA: 'AMZN_EU',
  CA_FBA: 'AMZN_CA',
  AU_FBA: 'AMZN_AU',
};

/** Sevkiyat item kolon gösterimi: destinasyon etiketi (FBA → "Amazon X", depo → "X Depo"). */
const COLUMN_DEST_LABELS: Record<string, string> = {
  US_FBA: 'Amazon US',
  UK_FBA: 'Amazon UK',
  EU_FBA: 'Amazon EU',
  CA_FBA: 'Amazon CA',
  AU_FBA: 'Amazon AU',
  NJ_DEPO: 'NJ Depo',
  CG_DEPO: 'CG Depo',
  NL_DEPO: 'NL Depo',
  UK_DEPO: 'UK Depo',
  ZA_TAKEALOT: 'Takealot',
};

const AMAZON_LABELS: Record<string, string> = {
  AMZN_US: 'Amazon US',
  AMZN_UK: 'Amazon UK',
  AMZN_EU: 'Amazon EU',
  AMZN_CA: 'Amazon CA',
  AMZN_AU: 'Amazon AU',
  // Amazon Citi (CUSTOM_01): FBA verisi elde yok → hedef boş bırakılır, operatör
  // pickup'ta US FBA / NJ Depo manuel seçer. Kolonda depoya düşmesin, "Amazon Citi" görünsün.
  CUSTOM_01: 'Amazon Citi',
};

const REGION_DEPOT_LABEL: Record<string, string> = { US: 'NJ Depo', EU: 'NL Depo', UK: 'UK Depo' };

/**
 * Bir shipment_item'ın kolon etiketi = fiziksel destinasyon (bölge-genel).
 * recommendedDestination öncelikli (havuzdan eklenen yeni item'lar bunu taşır);
 * yoksa marketplace'ten türetilir (legacy satırlar):
 *   Amazon → "Amazon US/UK/EU/CA/AU" (FBA), Wayfair US → "CG Depo",
 *   diğer kanallar → bölgenin deposu (US→NJ, EU→NL, UK→UK Depo).
 */
export function shipmentDestinationLabel(
  destinationTab: string,
  marketplaceCode: string | null | undefined,
  recommendedDestination: string | null | undefined
): string {
  if (recommendedDestination && COLUMN_DEST_LABELS[recommendedDestination]) {
    return COLUMN_DEST_LABELS[recommendedDestination];
  }
  if (marketplaceCode && AMAZON_LABELS[marketplaceCode]) return AMAZON_LABELS[marketplaceCode];
  if (marketplaceCode === 'WAYFAIR_US') return 'CG Depo';
  if (marketplaceCode) return REGION_DEPOT_LABEL[destinationTab] ?? marketplaceCode;
  return '—';
}

/**
 * Sevkiyat sayfası için: üst country tab → alt destinasyon tab listesi.
 * shipments.destinationTab field bu destinasyon kodlarını tutar.
 */
export type ShipmentCountry = 'US' | 'UK' | 'EU' | 'CA' | 'AU' | 'ZA';
export const SHIPMENT_COUNTRIES: ShipmentCountry[] = ['US', 'UK', 'EU', 'CA', 'AU', 'ZA'];

export const SHIPMENT_COUNTRY_LABELS: Record<ShipmentCountry, string> = {
  US: '🇺🇸 US', UK: '🇬🇧 UK', EU: '🇪🇺 EU', CA: '🇨🇦 CA', AU: '🇦🇺 AU', ZA: '🇿🇦 ZA',
};

export const SHIPMENT_DESTINATIONS_BY_COUNTRY: Record<ShipmentCountry, string[]> = {
  US: ['US_FBA', 'NJ_DEPO', 'CG_DEPO'],
  UK: ['UK_FBA', 'UK_DEPO'],
  EU: ['EU_FBA', 'NL_DEPO'],
  CA: ['CA_FBA'],
  AU: ['AU_FBA'],
  ZA: ['ZA_TAKEALOT'],
};

/** destination code → country (üst tab) */
export function countryForShipmentDestination(dest: string): ShipmentCountry | null {
  for (const [c, dests] of Object.entries(SHIPMENT_DESTINATIONS_BY_COUNTRY)) {
    if (dests.includes(dest)) return c as ShipmentCountry;
  }
  return null;
}

/**
 * recommendedDestination → badge stil (Tailwind sınıfları).
 * Mantık:
 *   - FBA'lar (Amazon direkt): "soğuk" tonlar (yeşil/mavi/indigo/cyan/teal)
 *   - Depolar: "sıcak/dikkat çekici" tonlar (amber/rose/pink/violet)
 *   - Operatör hızlı taramada FBA ile Depo'yu ayırt edebilir; ayrıca her bölge
 *     kendine özgü renge sahip (US FBA emerald, UK FBA sky, vs).
 */
export const SHIPMENT_DESTINATION_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  US_FBA:  { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
  UK_FBA:  { bg: 'bg-sky-50',      text: 'text-sky-700',     border: 'border-sky-200' },
  EU_FBA:  { bg: 'bg-indigo-50',   text: 'text-indigo-700',  border: 'border-indigo-200' },
  CA_FBA:  { bg: 'bg-cyan-50',     text: 'text-cyan-700',    border: 'border-cyan-200' },
  AU_FBA:  { bg: 'bg-teal-50',     text: 'text-teal-700',    border: 'border-teal-200' },
  NJ_DEPO: { bg: 'bg-amber-50',    text: 'text-amber-800',   border: 'border-amber-300' },
  CG_DEPO: { bg: 'bg-rose-50',     text: 'text-rose-700',    border: 'border-rose-300' },
  UK_DEPO: { bg: 'bg-pink-50',     text: 'text-pink-700',    border: 'border-pink-300' },
  NL_DEPO: { bg: 'bg-violet-50',   text: 'text-violet-700',  border: 'border-violet-300' },
  ZA_TAKEALOT: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
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
