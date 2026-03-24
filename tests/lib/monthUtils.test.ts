/**
 * Month Utilities Tests
 * Updated for new locking rule: month locks on the 1st of that month
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseMonthValue,
  formatMonthValue,
  formatMonthDisplay,
  isMonthLocked,
  getActiveMonths,
  getAvailableMonthsForEntry,
  getAllMonthsForViewing,
  getCurrentMonth,
  getMonthName,
  getYear,
} from '@/lib/monthUtils';

describe('monthUtils', () => {
  describe('parseMonthValue', () => {
    it('should parse valid month string to Date', () => {
      const result = parseMonthValue('2025-01');
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(0); // January is 0
      expect(result.getDate()).toBe(1); // First day of month
    });

    it('should handle December correctly', () => {
      const result = parseMonthValue('2025-12');
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(11); // December is 11
    });

    it('should handle single-digit months with zero padding', () => {
      const result = parseMonthValue('2025-03');
      expect(result.getMonth()).toBe(2); // March is 2
    });
  });

  describe('formatMonthValue', () => {
    it('should format Date to month value string', () => {
      const date = new Date(2025, 0, 15); // January 15, 2025
      const result = formatMonthValue(date);
      expect(result).toBe('2025-01');
    });

    it('should pad single-digit months with zero', () => {
      const date = new Date(2025, 8, 1); // September 1, 2025
      const result = formatMonthValue(date);
      expect(result).toBe('2025-09');
    });

    it('should handle December correctly', () => {
      const date = new Date(2025, 11, 31); // December 31, 2025
      const result = formatMonthValue(date);
      expect(result).toBe('2025-12');
    });
  });

  describe('formatMonthDisplay', () => {
    it('should format month value for display', () => {
      const result = formatMonthDisplay('2025-01');
      expect(result).toBe('Ocak 2025');
    });

    it('should handle all months correctly', () => {
      expect(formatMonthDisplay('2025-06')).toBe('Haziran 2025');
      expect(formatMonthDisplay('2025-12')).toBe('Aralık 2025');
    });
  });

  describe('isMonthLocked', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for past months', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      expect(isMonthLocked('2026-01')).toBe(true); // January - past
    });

    it('should return true for current month (locked on 1st)', () => {
      vi.setSystemTime(new Date(2026, 1, 1)); // February 1, 2026
      expect(isMonthLocked('2026-02')).toBe(true); // Feb locked because today >= Feb 1
    });

    it('should return true for current month mid-month', () => {
      vi.setSystemTime(new Date(2026, 1, 15)); // February 15, 2026
      expect(isMonthLocked('2026-02')).toBe(true);
    });

    it('should return false for next month (entries open)', () => {
      vi.setSystemTime(new Date(2026, 1, 15)); // February 15, 2026
      expect(isMonthLocked('2026-03')).toBe(false); // March entries open during Feb
    });

    it('should return false for future months', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      expect(isMonthLocked('2026-04')).toBe(false); // April - future
    });

    it('should lock month exactly on the 1st', () => {
      vi.setSystemTime(new Date(2026, 2, 1)); // March 1, 2026
      expect(isMonthLocked('2026-03')).toBe(true); // March locked on March 1
      expect(isMonthLocked('2026-04')).toBe(false); // April still open
    });

    it('should keep month open on last day of previous month', () => {
      vi.setSystemTime(new Date(2026, 1, 28)); // Feb 28, 2026
      expect(isMonthLocked('2026-03')).toBe(false); // March entries still open
    });
  });

  describe('getActiveMonths', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return 4 months (prev 1 + current + next 2)', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getActiveMonths();
      expect(result).toHaveLength(4);
      expect(result[0].value).toBe('2026-01'); // January
      expect(result[1].value).toBe('2026-02'); // February (current)
      expect(result[2].value).toBe('2026-03'); // March
      expect(result[3].value).toBe('2026-04'); // April
    });

    it('should mark current and past months as locked', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getActiveMonths();
      expect(result.find(m => m.value === '2026-01')?.locked).toBe(true); // past
      expect(result.find(m => m.value === '2026-02')?.locked).toBe(true); // current = locked
    });

    it('should mark future months as unlocked', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getActiveMonths();
      expect(result.find(m => m.value === '2026-03')?.locked).toBe(false);
      expect(result.find(m => m.value === '2026-04')?.locked).toBe(false);
    });

    it('should include proper labels', () => {
      vi.setSystemTime(new Date(2026, 1, 3)); // February 3, 2026
      const result = getActiveMonths();
      expect(result[1].label).toBe('Şubat 2026');
    });
  });

  describe('getAvailableMonthsForEntry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return only unlocked months', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getAvailableMonthsForEntry();

      result.forEach(month => {
        expect(isMonthLocked(month.value)).toBe(false);
      });
    });

    it('should not include current or past months', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getAvailableMonthsForEntry();

      // Current month (Feb) is locked, should not be in entry list
      expect(result.some(m => m.value === '2026-02')).toBe(false);
      expect(result.some(m => m.value === '2026-01')).toBe(false);
    });

    it('should include future months for entry', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getAvailableMonthsForEntry();

      expect(result.some(m => m.value === '2026-03')).toBe(true);
      expect(result.some(m => m.value === '2026-04')).toBe(true);
    });
  });

  describe('getAllMonthsForViewing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return 19 months by default (12 past + current + 6 future)', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getAllMonthsForViewing();
      expect(result).toHaveLength(19);
    });

    it('should return months in reverse order (most recent first)', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getAllMonthsForViewing();

      const firstMonthDate = parseMonthValue(result[0].value);
      const lastMonthDate = parseMonthValue(result[result.length - 1].value);
      expect(firstMonthDate.getTime()).toBeGreaterThan(lastMonthDate.getTime());
    });

    it('should respect custom pastMonths parameter', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getAllMonthsForViewing(6); // 6 past months
      expect(result).toHaveLength(13); // 6 past + current + 6 future
    });

    it('should include locked status for each month', () => {
      vi.setSystemTime(new Date(2026, 1, 10)); // February 10, 2026
      const result = getAllMonthsForViewing();

      result.forEach(month => {
        expect(month).toHaveProperty('locked');
        expect(typeof month.locked).toBe('boolean');
      });
    });
  });

  describe('getCurrentMonth', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return current month value', () => {
      vi.setSystemTime(new Date(2026, 1, 15)); // February 15, 2026
      const result = getCurrentMonth();
      expect(result).toBe('2026-02');
    });

    it('should format single-digit months with zero padding', () => {
      vi.setSystemTime(new Date(2026, 8, 1)); // September 1, 2026
      const result = getCurrentMonth();
      expect(result).toBe('2026-09');
    });
  });

  describe('getMonthName', () => {
    it('should return month name for valid month value', () => {
      expect(getMonthName('2025-01')).toBe('Ocak');
      expect(getMonthName('2025-06')).toBe('Haziran');
      expect(getMonthName('2025-12')).toBe('Aralık');
    });
  });

  describe('getYear', () => {
    it('should extract year from month value', () => {
      expect(getYear('2025-01')).toBe(2025);
      expect(getYear('2026-12')).toBe(2026);
      expect(getYear('2024-06')).toBe(2024);
    });
  });

  describe('Integration: Round-trip conversions', () => {
    it('should correctly convert between formats', () => {
      const originalValue = '2025-06';
      const date = parseMonthValue(originalValue);
      const reformattedValue = formatMonthValue(date);
      expect(reformattedValue).toBe(originalValue);
    });

    it('should maintain consistency across all format functions', () => {
      const monthValue = '2025-03';
      const date = parseMonthValue(monthValue);

      expect(formatMonthValue(date)).toBe(monthValue);
      expect(getMonthName(monthValue)).toBe('Mart');
      expect(getYear(monthValue)).toBe(2025);
      expect(formatMonthDisplay(monthValue)).toBe('Mart 2025');
    });
  });
});
