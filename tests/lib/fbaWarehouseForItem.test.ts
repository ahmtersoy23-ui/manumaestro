import { describe, it, expect } from 'vitest';
import { fbaWarehouseForItem } from '@/lib/marketplaceRegions';

describe('fbaWarehouseForItem — FBA-hedefli kalem → fba_inventory.warehouse', () => {
  it('recommendedDestination FBA kodları → depo kodu', () => {
    expect(fbaWarehouseForItem('AMZN_UK', 'UK_FBA')).toBe('UK');
    expect(fbaWarehouseForItem(null, 'EU_FBA')).toBe('EU');
    expect(fbaWarehouseForItem(null, 'US_FBA')).toBe('US');
    expect(fbaWarehouseForItem(null, 'CA_FBA')).toBe('CA');
    expect(fbaWarehouseForItem(null, 'AU_FBA')).toBe('AU');
  });

  it('depo / Citi / ZA destinasyonları → null (zenginleştirme yok)', () => {
    expect(fbaWarehouseForItem('AMZN_UK', 'UK_DEPO')).toBeNull();
    expect(fbaWarehouseForItem(null, 'NL_DEPO')).toBeNull();
    expect(fbaWarehouseForItem('AMZN_US', 'NJ_DEPO')).toBeNull();
    expect(fbaWarehouseForItem('AMZN_US', 'CG_DEPO')).toBeNull();
    expect(fbaWarehouseForItem('CUSTOM_01', 'CITI_FBA')).toBeNull(); // Citi fba_inventory'de yok
    expect(fbaWarehouseForItem(null, 'ZA_TAKEALOT')).toBeNull();
  });

  it('legacy (recommendedDestination yok): Amazon marketplace kodundan türetir', () => {
    expect(fbaWarehouseForItem('AMZN_US', null)).toBe('US');
    expect(fbaWarehouseForItem('AMZN_AU', undefined)).toBe('AU');
  });

  it('non-Amazon marketplace + recommendedDestination yok → null', () => {
    expect(fbaWarehouseForItem('WAYFAIR_US', null)).toBeNull();
    expect(fbaWarehouseForItem('BOL_NL', null)).toBeNull();
    expect(fbaWarehouseForItem(null, null)).toBeNull();
  });

  it('recommendedDestination öncelikli: UK_DEPO, AMZN_UK olsa bile null', () => {
    expect(fbaWarehouseForItem('AMZN_UK', 'UK_DEPO')).toBeNull();
  });
});
