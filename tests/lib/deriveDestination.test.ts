import { describe, expect, it } from 'vitest';
import { deriveRecommendedDestination } from '@/lib/shipments/deriveDestination';

describe('deriveRecommendedDestination — manuel/Excel girişte sevkiyat hedefi', () => {
  it('US depo kanalları (Shopify/Walmart/Etsy): ağırlığa göre NJ vs CG', () => {
    // hafif → NJ_DEPO
    expect(deriveRecommendedDestination('CUSTOM_07', 'IWA Metal', 2)).toBe('NJ_DEPO');
    expect(deriveRecommendedDestination('CUSTOM_05', 'Shukran Cam', 3)).toBe('NJ_DEPO');
    // ağır (≥7 normal kategori) → CG_DEPO
    expect(deriveRecommendedDestination('CUSTOM_03', 'IWA Metal', 8)).toBe('CG_DEPO');
  });

  it('Mobilya/Alsat ≥4 desi → ağır = CG (düşük eşik)', () => {
    expect(deriveRecommendedDestination('CUSTOM_07', 'Mobilya', 4)).toBe('CG_DEPO');
    expect(deriveRecommendedDestination('CUSTOM_07', 'Alsat', 6.3)).toBe('CG_DEPO');
    // Mobilya <4 → hafif → NJ
    expect(deriveRecommendedDestination('CUSTOM_07', 'Mobilya', 3)).toBe('NJ_DEPO');
  });

  it('Amazon pazar yerleri → bölge FBA (UK Mobilya hariç)', () => {
    expect(deriveRecommendedDestination('AMZN_US', 'IWA Metal', 2)).toBe('US_FBA');
    expect(deriveRecommendedDestination('AMZN_EU', 'IWA Metal', 2)).toBe('EU_FBA');
    expect(deriveRecommendedDestination('AMZN_CA', 'IWA Metal', 2)).toBe('CA_FBA');
    expect(deriveRecommendedDestination('AMZN_AU', 'IWA Metal', 2)).toBe('AU_FBA');
    expect(deriveRecommendedDestination('AMZN_UK', 'IWA Metal', 2)).toBe('UK_FBA');
    expect(deriveRecommendedDestination('AMZN_UK', 'Mobilya', 5)).toBe('UK_DEPO');
  });

  it('özel kanallar: Citi → CITI_FBA, Wayfair US → CG, Bol/Kaufland → NL', () => {
    expect(deriveRecommendedDestination('CUSTOM_01', 'IWA Metal', 2)).toBe('CITI_FBA');
    expect(deriveRecommendedDestination('WAYFAIR_US', 'IWA Metal', 2)).toBe('CG_DEPO');
    expect(deriveRecommendedDestination('BOL_NL', 'IWA Metal', 2)).toBe('NL_DEPO');
    expect(deriveRecommendedDestination('CUSTOM_02', 'IWA Metal', 2)).toBe('NL_DEPO');
  });

  it('belirsiz pazar yeri / kod yok / desi yok güvenli davranır', () => {
    // Ebay / Trendyol / Sezon / Takealot → null (operatör veya sync doldurur)
    expect(deriveRecommendedDestination('CUSTOM_04', 'IWA Metal', 5)).toBeNull();
    expect(deriveRecommendedDestination('CUSTOM_06', 'IWA Metal', 5)).toBeNull();
    expect(deriveRecommendedDestination('SEZON', 'IWA Metal', 5)).toBeNull();
    expect(deriveRecommendedDestination('TAKEALOT_ZA', 'IWA Metal', 5)).toBeNull();
    expect(deriveRecommendedDestination(null, 'IWA Metal', 5)).toBeNull();
    // desi yok → ağır değil → depo kanalında NJ
    expect(deriveRecommendedDestination('CUSTOM_07', 'IWA Metal', null)).toBe('NJ_DEPO');
  });
});
