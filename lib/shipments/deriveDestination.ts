import { isHeavyItem } from '@/lib/products/lookup';

/**
 * Manuel ve Excel ile girilen üretim talepleri için sevkiyat hedefini
 * (recommendedDestination) türetir.
 *
 * StockPulse sync'i bu kolonu kendi routing'iyle yazar; manuel/Excel girişlerde
 * boş kalmasın diye aynı mantığı pazar yeri kodu + ağırlık (isHeavyItem) ile uygular:
 *   - US depo kanalları (Shopify/Walmart/Etsy): isHeavyItem ? CG_DEPO : NJ_DEPO
 *     (Mobilya/Alsat ≥4 desi, diğerleri ≥7 → ağır = CG)
 *   - Amazon US → US_FBA, UK → Mobilya ise UK_DEPO yoksa UK_FBA, EU/CA/AU → bölge FBA
 *   - Amazon Citi → CITI_FBA, Wayfair US → CG_DEPO, Bol/Kaufland → NL_DEPO
 *   - Belirsiz pazar yerleri (Ebay/Trendyol/Sezon/Takealot) → null
 *     (operatör elle ya da sonraki StockPulse sync doldurur)
 *
 * Not: recommendedDestination kolonu VarChar(10) — ZA_TAKEALOT (11) emit edilmez.
 */
export function deriveRecommendedDestination(
  marketplaceCode: string | null | undefined,
  category: string | null | undefined,
  desi: number | null | undefined
): string | null {
  if (!marketplaceCode) return null;
  const heavy = isHeavyItem(category, desi);
  const isMobilya = (category || '').trim().toLowerCase() === 'mobilya';

  switch (marketplaceCode) {
    case 'AMZN_US':
      return 'US_FBA';
    case 'AMZN_UK':
      return isMobilya ? 'UK_DEPO' : 'UK_FBA';
    case 'AMZN_EU':
      return 'EU_FBA';
    case 'AMZN_CA':
      return 'CA_FBA';
    case 'AMZN_AU':
      return 'AU_FBA';
    case 'CUSTOM_07': // Shopify
    case 'CUSTOM_05': // Walmart
    case 'CUSTOM_03': // Etsy
      return heavy ? 'CG_DEPO' : 'NJ_DEPO';
    case 'CUSTOM_01': // Amazon Citi — ayrı FBA kovası
      return 'CITI_FBA';
    case 'WAYFAIR_US': // Castle Gate
      return 'CG_DEPO';
    case 'WAYFAIR_UK':
      return 'UK_DEPO';
    case 'BOL_NL':
    case 'CUSTOM_02': // Kaufland
      return 'NL_DEPO';
    default:
      // Ebay (CUSTOM_04), Trendyol (CUSTOM_06), Sezon (SEZON), Takealot (TAKEALOT_ZA) → belirsiz
      return null;
  }
}
