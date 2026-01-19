/**
 * ManuMaestro - TypeScript Type Definitions
 */

// Re-export Prisma types
export type {
  User,
  Marketplace,
  ProductionRequest,
  UserMarketplacePermission,
  UserRole,
  MarketplaceType,
  RequestStatus,
  EntryType,
} from '@prisma/client';

// UI Types
export interface MarketplaceCardData {
  id: string;
  name: string;
  code: string;
  marketplaceType: string;
  region: string;
  colorTag?: string | null;
  requestCount?: number;
}

export interface ProductData {
  iwasku: string;
  name: string;
  category: string;
  // Add more fields as needed from your products table
}

export interface ProductionRequestInput {
  iwasku: string;
  productName: string;
  productCategory: string;
  marketplaceId: string;
  quantity: number;
  notes?: string;
}

export interface ManufacturerSummary {
  iwasku: string;
  productName: string;
  productCategory: string;
  totalQuantity: number;
  breakdown: {
    marketplaceName: string;
    marketplaceCode: string;
    quantity: number;
  }[];
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Session/Auth types (for future SSO)
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}
