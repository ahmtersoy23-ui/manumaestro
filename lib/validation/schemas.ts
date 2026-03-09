/**
 * Validation Schemas
 * Zod schemas for API input validation
 */

import { z } from 'zod';

/**
 * Production Request Schema
 */
export const ProductionRequestSchema = z.object({
  iwasku: z.string().min(1, 'IWASKU is required').max(50, 'IWASKU too long'),
  productName: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
  productCategory: z.string().min(1, 'Product category is required').max(100, 'Category too long'),
  productSize: z.number().positive('Size must be positive').optional().nullable(),
  marketplaceId: z.string().uuid('Invalid marketplace ID'),
  quantity: z.number().int('Quantity must be integer').positive('Quantity must be positive').max(999999, 'Quantity too large'),
  productionMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format. Expected YYYY-MM'),
  notes: z.string().max(500, 'Notes too long').optional().nullable(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().default('MEDIUM'),
});

/**
 * Bulk Request Schema
 */
export const BulkRequestSchema = z.object({
  requests: z.array(z.object({
    iwasku: z.string().min(1).max(50),
    quantity: z.number().int().positive().max(999999),
    notes: z.string().max(500).optional().nullable(),
  })).min(1, 'At least one request required').max(1000, 'Too many requests (max 1000)'),
  marketplaceId: z.string().uuid('Invalid marketplace ID'),
  productionMonth: z.string().regex(/^\d{4}-\d{2}$/),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().default('MEDIUM'),
});

/**
 * Manufacturer Update Schema
 */
export const ManufacturerUpdateSchema = z.object({
  producedQuantity: z.number().int('Produced quantity must be integer').nonnegative('Cannot be negative').max(999999, 'Quantity too large').optional(),
  manufacturerNotes: z.string().max(500, 'Notes too long').optional().nullable(),
  status: z.enum(['REQUESTED', 'IN_PRODUCTION', 'PARTIALLY_PRODUCED', 'COMPLETED', 'CANCELLED']).optional(),
  workflowStage: z.enum(['REQUESTED', 'CUTTING', 'ASSEMBLY', 'QUALITY_CHECK', 'PACKAGING', 'READY_TO_SHIP']).optional(),
});

/**
 * Marketplace Creation Schema
 */
export const MarketplaceCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  region: z.string().min(1, 'Region is required').max(50, 'Region too long'),
  marketplaceType: z.enum([
    'AMAZON',
    'WAYFAIR',
    'TAKEALOT',
    'BOL',
    'TRENDYOL',
    'ETSY',
    'CUSTOM',
    'OTHER'
  ]).optional(),
});

/**
 * Marketplace Permission Schema
 */
export const MarketplacePermissionSchema = z.object({
  userId: z.string().uuid('Geçersiz kullanıcı ID'),
  marketplaceId: z.string().uuid('Geçersiz pazar yeri ID'),
  canView: z.boolean(),
  canEdit: z.boolean(),
}).refine(d => !(d.canEdit && !d.canView), {
  message: 'Düzenleme izni görüntüleme iznini gerektirir',
  path: ['canView'],
});

/**
 * Category Permission Schema
 */
export const CategoryPermissionSchema = z.object({
  userId: z.string().uuid('Geçersiz kullanıcı ID'),
  category: z.string().min(1).max(100),
  canView: z.boolean(),
  canEdit: z.boolean(),
}).refine(d => !(d.canEdit && !d.canView), {
  message: 'Düzenleme izni görüntüleme iznini gerektirir',
  path: ['canView'],
});

/**
 * Month Parameter Schema
 */
export const MonthParamSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format. Expected YYYY-MM');

/**
 * UUID Parameter Schema
 */
export const UUIDParamSchema = z.string().uuid('Invalid ID format');

/**
 * Helper function to validate and return parsed data
 */
export function validateSchema<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}

/**
 * Format Zod error for API response
 */
export function formatValidationError(error: z.ZodError): { field: string; message: string }[] {
  const issues = error.issues || [];

  return issues.map((issue: z.ZodIssue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}
