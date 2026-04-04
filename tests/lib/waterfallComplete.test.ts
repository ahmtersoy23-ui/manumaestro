/**
 * Waterfall Completion Tests
 * Priority-based status distribution for production requests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the module under test
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();
const mockPriorityFindMany = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    monthSnapshot: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    productionRequest: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    marketplacePriority: {
      findMany: (...args: unknown[]) => mockPriorityFindMany(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { waterfallComplete } from '@/lib/waterfallComplete';

describe('waterfallComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockUpdate.mockResolvedValue({});
  });

  it('should return 0 when no snapshot exists', async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await waterfallComplete('SKU-001', '2026-04');

    expect(result).toBe(0);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { month_iwasku: { month: '2026-04', iwasku: 'SKU-001' } },
    });
    // No further DB calls should be made
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('should set ALL requests to COMPLETED when totalAvailable >= totalRequested', async () => {
    mockFindUnique.mockResolvedValue({
      warehouseStock: 30,
      produced: 70,
      totalRequested: 100,
    });

    mockFindMany.mockResolvedValue([
      { id: 'r1', marketplaceId: 'mp1', quantity: 60, status: 'REQUESTED' },
      { id: 'r2', marketplaceId: 'mp2', quantity: 40, status: 'REQUESTED' },
    ]);

    mockUpdateMany.mockResolvedValue({ count: 2 });

    const result = await waterfallComplete('SKU-001', '2026-04');

    expect(result).toBe(2);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        iwasku: 'SKU-001',
        productionMonth: '2026-04',
        status: { not: 'COMPLETED' },
      },
      data: { status: 'COMPLETED' },
    });
    // Should NOT enter priority distribution
    expect(mockPriorityFindMany).not.toHaveBeenCalled();
  });

  it('should set ALL requests to REQUESTED when produced=0 and warehouseStock=0', async () => {
    mockFindUnique.mockResolvedValue({
      warehouseStock: 0,
      produced: 0,
      totalRequested: 100,
    });

    mockFindMany.mockResolvedValue([
      { id: 'r1', marketplaceId: 'mp1', quantity: 60, status: 'COMPLETED' },
      { id: 'r2', marketplaceId: 'mp2', quantity: 40, status: 'PARTIALLY_PRODUCED' },
    ]);

    mockUpdateMany.mockResolvedValue({ count: 2 });

    const result = await waterfallComplete('SKU-001', '2026-04');

    expect(result).toBe(2);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        iwasku: 'SKU-001',
        productionMonth: '2026-04',
        status: { not: 'REQUESTED' },
      },
      data: { status: 'REQUESTED' },
    });
    // Should NOT enter priority distribution
    expect(mockPriorityFindMany).not.toHaveBeenCalled();
  });

  it('should distribute partial availability by marketplace priority', async () => {
    // Available = 20 (stock) + 30 (produced) = 50, totalRequested = 56
    mockFindUnique.mockResolvedValue({
      warehouseStock: 20,
      produced: 30,
      totalRequested: 56,
    });

    mockFindMany.mockResolvedValue([
      { id: 'r-takealot', marketplaceId: 'mp-takealot', quantity: 6, status: 'REQUESTED' },
      { id: 'r-au', marketplaceId: 'mp-au', quantity: 30, status: 'REQUESTED' },
      { id: 'r-us', marketplaceId: 'mp-us', quantity: 20, status: 'REQUESTED' },
    ]);

    mockPriorityFindMany.mockResolvedValue([
      { marketplaceId: 'mp-takealot', priority: 1 },
      { marketplaceId: 'mp-au', priority: 2 },
      { marketplaceId: 'mp-us', priority: 3 },
    ]);

    const result = await waterfallComplete('SKU-001', '2026-04');

    // All 3 requests changed status
    expect(result).toBe(3);

    // Takealot (priority 1): 50 >= 6 -> COMPLETED, remaining = 44
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r-takealot' },
      data: { status: 'COMPLETED' },
    });

    // AU (priority 2): 44 >= 30 -> COMPLETED, remaining = 14
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r-au' },
      data: { status: 'COMPLETED' },
    });

    // US (priority 3): 14 < 20 -> PARTIALLY_PRODUCED, remaining = 0
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r-us' },
      data: { status: 'PARTIALLY_PRODUCED' },
    });
  });

  it('should return 0 when no priorities are set (partial case)', async () => {
    // totalAvailable (15) < totalRequested (100), and produced > 0
    // This triggers priority distribution path, but no priorities exist
    mockFindUnique.mockResolvedValue({
      warehouseStock: 5,
      produced: 10,
      totalRequested: 100,
    });

    mockFindMany.mockResolvedValue([
      { id: 'r1', marketplaceId: 'mp1', quantity: 60, status: 'REQUESTED' },
      { id: 'r2', marketplaceId: 'mp2', quantity: 40, status: 'REQUESTED' },
    ]);

    mockPriorityFindMany.mockResolvedValue([]);

    const result = await waterfallComplete('SKU-001', '2026-04');

    expect(result).toBe(0);
    // Should not try to update individual requests
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should set a single request to COMPLETED when fully covered', async () => {
    // totalAvailable = 50 + 0 = 50, totalRequested = 80 (partial path)
    // But only one request exists with quantity=30, which fits
    mockFindUnique.mockResolvedValue({
      warehouseStock: 50,
      produced: 0,
      totalRequested: 80,
    });

    mockFindMany.mockResolvedValue([
      { id: 'r1', marketplaceId: 'mp1', quantity: 30, status: 'REQUESTED' },
    ]);

    mockPriorityFindMany.mockResolvedValue([
      { marketplaceId: 'mp1', priority: 1 },
    ]);

    const result = await waterfallComplete('SKU-001', '2026-04');

    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'COMPLETED' },
    });
  });

  it('should return 0 when snapshot exists but no requests exist', async () => {
    mockFindUnique.mockResolvedValue({
      warehouseStock: 100,
      produced: 50,
      totalRequested: 0,
    });

    mockFindMany.mockResolvedValue([]);

    const result = await waterfallComplete('SKU-001', '2026-04');

    expect(result).toBe(0);
  });

  it('should not count unchanged statuses in the return value', async () => {
    // Partial distribution: available=50, totalRequested=56
    mockFindUnique.mockResolvedValue({
      warehouseStock: 20,
      produced: 30,
      totalRequested: 56,
    });

    // r-takealot is already COMPLETED -- no status change needed
    mockFindMany.mockResolvedValue([
      { id: 'r-takealot', marketplaceId: 'mp-takealot', quantity: 6, status: 'COMPLETED' },
      { id: 'r-au', marketplaceId: 'mp-au', quantity: 30, status: 'REQUESTED' },
      { id: 'r-us', marketplaceId: 'mp-us', quantity: 20, status: 'REQUESTED' },
    ]);

    mockPriorityFindMany.mockResolvedValue([
      { marketplaceId: 'mp-takealot', priority: 1 },
      { marketplaceId: 'mp-au', priority: 2 },
      { marketplaceId: 'mp-us', priority: 3 },
    ]);

    const result = await waterfallComplete('SKU-001', '2026-04');

    // Only 2 changed (AU and US). Takealot was already COMPLETED.
    expect(result).toBe(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('should assign REQUESTED to unfilled requests after remaining hits 0', async () => {
    // available = 10, totalRequested = 100
    mockFindUnique.mockResolvedValue({
      warehouseStock: 5,
      produced: 5,
      totalRequested: 100,
    });

    mockFindMany.mockResolvedValue([
      { id: 'r1', marketplaceId: 'mp1', quantity: 8, status: 'REQUESTED' },
      { id: 'r2', marketplaceId: 'mp2', quantity: 50, status: 'COMPLETED' },
      { id: 'r3', marketplaceId: 'mp3', quantity: 42, status: 'COMPLETED' },
    ]);

    mockPriorityFindMany.mockResolvedValue([
      { marketplaceId: 'mp1', priority: 1 },
      { marketplaceId: 'mp2', priority: 2 },
      { marketplaceId: 'mp3', priority: 3 },
    ]);

    const result = await waterfallComplete('SKU-001', '2026-04');

    // r1: 10 >= 8 -> COMPLETED (no change since already REQUESTED -> changed)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'COMPLETED' },
    });

    // r2: remaining=2, 2 < 50 -> PARTIALLY_PRODUCED (was COMPLETED -> changed)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: { status: 'PARTIALLY_PRODUCED' },
    });

    // r3: remaining=0 -> REQUESTED (was COMPLETED -> changed)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r3' },
      data: { status: 'REQUESTED' },
    });

    expect(result).toBe(3);
  });
});
