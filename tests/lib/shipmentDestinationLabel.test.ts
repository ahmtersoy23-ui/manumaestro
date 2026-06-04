import { describe, expect, it } from 'vitest';
import { shipmentDestinationLabel } from '@/lib/marketplaceRegions';

describe('shipmentDestinationLabel — kolon = fiziksel destinasyon', () => {
  it('recommendedDestination öncelikli: FBA → Amazon X, depo → X Depo', () => {
    expect(shipmentDestinationLabel('US', 'AMZN_US', 'US_FBA')).toBe('Amazon US');
    expect(shipmentDestinationLabel('US', null, 'CG_DEPO')).toBe('CG Depo');
    expect(shipmentDestinationLabel('US', null, 'NJ_DEPO')).toBe('NJ Depo');
    expect(shipmentDestinationLabel('EU', 'AMZN_EU', 'EU_FBA')).toBe('Amazon EU');
    expect(shipmentDestinationLabel('EU', null, 'NL_DEPO')).toBe('NL Depo');
    expect(shipmentDestinationLabel('UK', 'AMZN_UK', 'UK_FBA')).toBe('Amazon UK');
  });

  it('recommendedDestination yoksa marketplace’ten türetir (legacy satırlar)', () => {
    expect(shipmentDestinationLabel('US', 'AMZN_US', null)).toBe('Amazon US');
    expect(shipmentDestinationLabel('US', 'WAYFAIR_US', null)).toBe('CG Depo');
    expect(shipmentDestinationLabel('US', 'CUSTOM_05', null)).toBe('NJ Depo'); // Walmart → NJ Depo
    expect(shipmentDestinationLabel('US', 'CUSTOM_07', null)).toBe('NJ Depo'); // Shopify
    expect(shipmentDestinationLabel('US', 'CUSTOM_01', null)).toBe('Amazon Citi'); // Citi → pickup, depoya düşmez
    expect(shipmentDestinationLabel('EU', 'CUSTOM_02', null)).toBe('NL Depo'); // Bol/Kaufland → NL Depo
    expect(shipmentDestinationLabel('EU', 'AMZN_EU', null)).toBe('Amazon EU');
    expect(shipmentDestinationLabel('UK', 'AMZN_UK', null)).toBe('Amazon UK');
    expect(shipmentDestinationLabel('UK', 'WAYFAIR_UK', null)).toBe('UK Depo'); // UK kanalı → UK Depo
  });

  it('recommendedDestination, marketplace’ten önceliklidir', () => {
    // Amazon ürünü CG depoya yönlendirilmişse → CG Depo
    expect(shipmentDestinationLabel('US', 'AMZN_US', 'CG_DEPO')).toBe('CG Depo');
  });

  it('hiçbir bilgi yoksa —', () => {
    expect(shipmentDestinationLabel('US', null, null)).toBe('—');
  });
});
