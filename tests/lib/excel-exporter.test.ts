/**
 * Excel Exporter Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatDateForExcel,
  formatStatusForExcel,
} from '@/lib/excel/exporter';

describe('Excel Exporter Utilities', () => {
  describe('formatDateForExcel', () => {
    it('should format Date object correctly', () => {
      const date = new Date('2026-02-11');
      const formatted = formatDateForExcel(date);
      // Turkish locale uses dots as separators
      expect(formatted).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    });

    it('should format string date correctly', () => {
      const dateStr = '2026-02-11T10:00:00Z';
      const formatted = formatDateForExcel(dateStr);
      // Turkish locale uses dots as separators
      expect(formatted).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    });

    it('should handle null/undefined', () => {
      expect(formatDateForExcel(null)).toBe('');
      expect(formatDateForExcel(undefined)).toBe('');
    });

    it('should handle invalid dates', () => {
      const formatted = formatDateForExcel('invalid-date');
      expect(formatted).toBe('');
    });
  });

  describe('formatStatusForExcel', () => {
    it('should format REQUESTED status', () => {
      const formatted = formatStatusForExcel('REQUESTED');
      expect(formatted).toBe('Talep Edildi');
    });

    it('should format IN_PRODUCTION status', () => {
      const formatted = formatStatusForExcel('IN_PRODUCTION');
      expect(formatted).toBe('Üretimde');
    });

    it('should format COMPLETED status', () => {
      const formatted = formatStatusForExcel('COMPLETED');
      expect(formatted).toBe('Tamamlandı');
    });

    it('should format CANCELLED status', () => {
      const formatted = formatStatusForExcel('CANCELLED');
      expect(formatted).toBe('İptal');
    });
  });
});
