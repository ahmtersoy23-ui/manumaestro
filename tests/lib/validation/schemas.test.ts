import { describe, it, expect } from 'vitest';
import {
  BulkRequestSchema,
  ManufacturerUpdateSchema,
  MarketplaceCreateSchema,
  MarketplacePermissionSchema,
  CategoryPermissionSchema,
  RouteToShipmentSchema,
  MonthParamSchema,
  UUIDParamSchema,
} from '@/lib/validation/schemas';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('BulkRequestSchema', () => {
  it('geçerli istek + priority default MEDIUM', () => {
    const r = BulkRequestSchema.safeParse({
      requests: [{ iwasku: 'A', quantity: 5 }],
      marketplaceId: UUID,
      productionMonth: '2026-06',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.requests[0].priority).toBe('MEDIUM');
  });
  it('boş requests reddedilir', () => {
    expect(BulkRequestSchema.safeParse({ requests: [], marketplaceId: UUID, productionMonth: '2026-06' }).success).toBe(false);
  });
  it('1000 üstü reddedilir', () => {
    const requests = Array.from({ length: 1001 }, () => ({ iwasku: 'A', quantity: 1 }));
    expect(BulkRequestSchema.safeParse({ requests, marketplaceId: UUID, productionMonth: '2026-06' }).success).toBe(false);
  });
  it('quantity 0/negatif reddedilir, geçersiz ay reddedilir', () => {
    expect(BulkRequestSchema.safeParse({ requests: [{ iwasku: 'A', quantity: 0 }], marketplaceId: UUID, productionMonth: '2026-06' }).success).toBe(false);
    expect(BulkRequestSchema.safeParse({ requests: [{ iwasku: 'A', quantity: 5 }], marketplaceId: UUID, productionMonth: '2026/06' }).success).toBe(false);
  });
});

describe('ManufacturerUpdateSchema', () => {
  it('geçerli status/stage', () => {
    expect(ManufacturerUpdateSchema.safeParse({ producedQuantity: 10, status: 'IN_PRODUCTION', workflowStage: 'CUTTING' }).success).toBe(true);
  });
  it('negatif producedQuantity reddedilir', () => {
    expect(ManufacturerUpdateSchema.safeParse({ producedQuantity: -1 }).success).toBe(false);
  });
  it('geçersiz enum reddedilir', () => {
    expect(ManufacturerUpdateSchema.safeParse({ status: 'SHIPPED' }).success).toBe(false);
  });
});

describe('MarketplaceCreateSchema', () => {
  it('geçerli', () => {
    expect(MarketplaceCreateSchema.safeParse({ name: 'Amazon US', region: 'US', marketplaceType: 'AMAZON' }).success).toBe(true);
  });
  it('boş name reddedilir, geçersiz tip reddedilir', () => {
    expect(MarketplaceCreateSchema.safeParse({ name: '', region: 'US' }).success).toBe(false);
    expect(MarketplaceCreateSchema.safeParse({ name: 'X', region: 'US', marketplaceType: 'EBAY' }).success).toBe(false);
  });
});

describe('Marketplace/Category PermissionSchema — canEdit→canView refine', () => {
  it('canEdit:true + canView:false reddedilir', () => {
    expect(MarketplacePermissionSchema.safeParse({ userId: UUID, marketplaceId: UUID, canView: false, canEdit: true }).success).toBe(false);
    expect(CategoryPermissionSchema.safeParse({ userId: UUID, category: 'Mobilya', canView: false, canEdit: true }).success).toBe(false);
  });
  it('canEdit:true + canView:true geçerli', () => {
    expect(MarketplacePermissionSchema.safeParse({ userId: UUID, marketplaceId: UUID, canView: true, canEdit: true }).success).toBe(true);
  });
  it('sadece view geçerli', () => {
    expect(CategoryPermissionSchema.safeParse({ userId: UUID, category: 'Mobilya', canView: true, canEdit: false }).success).toBe(true);
  });
});

describe('RouteToShipmentSchema', () => {
  it('geçerli', () => {
    expect(RouteToShipmentSchema.safeParse({ requestIds: [UUID], shipmentId: UUID }).success).toBe(true);
  });
  it('boş requestIds + geçersiz uuid reddedilir', () => {
    expect(RouteToShipmentSchema.safeParse({ requestIds: [], shipmentId: UUID }).success).toBe(false);
    expect(RouteToShipmentSchema.safeParse({ requestIds: ['not-uuid'], shipmentId: UUID }).success).toBe(false);
  });
});

describe('MonthParamSchema / UUIDParamSchema', () => {
  it('ay formatı YYYY-MM', () => {
    expect(MonthParamSchema.safeParse('2026-06').success).toBe(true);
    expect(MonthParamSchema.safeParse('2026-6').success).toBe(false);
    expect(MonthParamSchema.safeParse('Haziran').success).toBe(false);
  });
  it('uuid', () => {
    expect(UUIDParamSchema.safeParse(UUID).success).toBe(true);
    expect(UUIDParamSchema.safeParse('123').success).toBe(false);
  });
});
