/**
 * Validation Schemas Tests
 * Tests for Zod validation schemas
 */

import { describe, it, expect } from 'vitest';
import {
  BulkRequestSchema,
  ManufacturerUpdateSchema,
  MarketplaceCreateSchema,
  UUIDParamSchema,
  formatValidationError,
} from '@/lib/validation/schemas';

describe('Validation Schemas', () => {
  describe('BulkRequestSchema', () => {
    it('should validate correct bulk request', () => {
      const validData = {
        requests: [
          {
            iwasku: 'IWA-12345',
            quantity: 100,
            notes: 'Test note',
          },
        ],
        marketplaceId: '123e4567-e89b-12d3-a456-426614174000',
        productionMonth: '2026-03',
      };

      const result = BulkRequestSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid quantity', () => {
      const invalidData = {
        requests: [
          {
            iwasku: 'IWA-12345',
            quantity: -10, // Negative quantity
          },
        ],
        marketplaceId: '123e4567-e89b-12d3-a456-426614174000',
        productionMonth: '2026-03',
      };

      const result = BulkRequestSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty requests array', () => {
      const invalidData = {
        requests: [],
        marketplaceId: '123e4567-e89b-12d3-a456-426614174000',
        productionMonth: '2026-03',
      };

      const result = BulkRequestSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject too many requests', () => {
      const invalidData = {
        requests: Array(1001).fill({
          iwasku: 'IWA-12345',
          quantity: 10,
        }),
        marketplaceId: '123e4567-e89b-12d3-a456-426614174000',
        productionMonth: '2026-03',
      };

      const result = BulkRequestSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid production month format', () => {
      const invalidData = {
        requests: [
          {
            iwasku: 'IWA-12345',
            quantity: 100,
          },
        ],
        marketplaceId: '123e4567-e89b-12d3-a456-426614174000',
        productionMonth: '2026/03', // Wrong format
      };

      const result = BulkRequestSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('ManufacturerUpdateSchema', () => {
    it('should validate correct manufacturer update', () => {
      const validData = {
        producedQuantity: 50,
        manufacturerNotes: 'Production completed',
        status: 'COMPLETED',
      };

      const result = ManufacturerUpdateSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should allow partial updates', () => {
      const validData = {
        producedQuantity: 50,
      };

      const result = ManufacturerUpdateSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject negative produced quantity', () => {
      const invalidData = {
        producedQuantity: -5,
      };

      const result = ManufacturerUpdateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const invalidData = {
        status: 'INVALID_STATUS',
      };

      const result = ManufacturerUpdateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('MarketplaceCreateSchema', () => {
    it('should validate correct marketplace', () => {
      const validData = {
        name: 'Test Marketplace',
        region: 'EU',
        marketplaceType: 'CUSTOM',
      };

      const result = MarketplaceCreateSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const invalidData = {
        name: '',
        region: 'EU',
      };

      const result = MarketplaceCreateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('UUIDParamSchema', () => {
    it('should validate correct UUID', () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      const result = UUIDParamSchema.safeParse(validUUID);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const invalidUUID = 'not-a-uuid';
      const result = UUIDParamSchema.safeParse(invalidUUID);
      expect(result.success).toBe(false);
    });
  });

  describe('formatValidationError', () => {
    it('should format validation errors correctly', () => {
      const invalidData = {
        requests: [],
        marketplaceId: 'invalid-uuid',
        productionMonth: '2026-03',
      };

      const result = BulkRequestSchema.safeParse(invalidData);
      expect(result.success).toBe(false);

      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(Array.isArray(formatted)).toBe(true);
        expect(formatted.length).toBeGreaterThan(0);
        expect(formatted[0]).toHaveProperty('field');
        expect(formatted[0]).toHaveProperty('message');
      }
    });
  });
});
