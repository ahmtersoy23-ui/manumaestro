import { describe, it, expect } from 'vitest';
import {
  isSeasonalEligibleCategory,
  getMinBatchSize,
  getMinTailSize,
  getLeadTimePriority,
  getWeightedLeadTime,
  getLeadTimeFactor,
} from '@/lib/seasonal/config';

describe('isSeasonalEligibleCategory', () => {
  it('alsat/mobilya/tekstil hariç (case-insensitive + trim)', () => {
    expect(isSeasonalEligibleCategory('  Alsat  ')).toBe(false); // trim + lowercase
    expect(isSeasonalEligibleCategory('MOBILYA')).toBe(false);   // ASCII upper
    expect(isSeasonalEligibleCategory('mobilya')).toBe(false);
    expect(isSeasonalEligibleCategory('tekstil')).toBe(false);
  });
  it('boş/bilinmeyen → dahil (true)', () => {
    expect(isSeasonalEligibleCategory(null)).toBe(true);
    expect(isSeasonalEligibleCategory(undefined)).toBe(true);
    expect(isSeasonalEligibleCategory('')).toBe(true);
    expect(isSeasonalEligibleCategory('Aydınlatma')).toBe(true);
  });
});

describe('sabitler', () => {
  it('MIN_BATCH=15, MIN_TAIL=3', () => {
    expect(getMinBatchSize()).toBe(15);
    expect(getMinTailSize()).toBe(3);
  });
});

describe('getLeadTimePriority (105 güne normalize)', () => {
  it('AU=1.0, US≈0.571', () => {
    expect(getLeadTimePriority('AU')).toBe(1);
    expect(getLeadTimePriority('US')).toBeCloseTo(60 / 105, 5);
  });
  it('bilinmeyen destinasyon → 0', () => {
    expect(getLeadTimePriority('MARS')).toBe(0);
  });
});

describe('getWeightedLeadTime', () => {
  it('tek pazar → o pazarın gün sayısı', () => {
    expect(getWeightedLeadTime({ US: 100 })).toBe(60);
  });
  it('karma → adet-ağırlıklı ortalama', () => {
    // US(60)*100 + AU(105)*100 = 16500 / 200 = 82.5
    expect(getWeightedLeadTime({ US: 100, AU: 100 })).toBe(82.5);
  });
  it('qty<=0 yok sayılır', () => {
    expect(getWeightedLeadTime({ US: 100, AU: 0 })).toBe(60);
  });
  it('bilinmeyen pazar → 30 gün varsayılan', () => {
    expect(getWeightedLeadTime({ MARS: 50 })).toBe(30);
  });
  it('boş/sıfır → 30 varsayılan', () => {
    expect(getWeightedLeadTime({})).toBe(30);
    expect(getWeightedLeadTime({ US: 0 })).toBe(30);
  });
});

describe('getLeadTimeFactor (0-1 clamp)', () => {
  it('AU→1, US≈0.571', () => {
    expect(getLeadTimeFactor({ AU: 10 })).toBe(1);
    expect(getLeadTimeFactor({ US: 10 })).toBeCloseTo(60 / 105, 5);
  });
});
