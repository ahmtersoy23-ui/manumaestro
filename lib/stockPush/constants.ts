/**
 * Stok push kanallari. Ilk implemente: AMAZON_US (FBM). Sonra SHOPIFY_US/WALMART_US
 * `implemented:true` yapilip compute/adaptor eklenir — UI sekmesi + model hazir.
 */
export interface StockPushChannel {
  key: string;
  label: string;
  /** pricelab channel_prices.channel_code */
  channelCode: string;
  country: string;
  implemented: boolean;
}

export const STOCK_PUSH_CHANNELS: StockPushChannel[] = [
  { key: 'AMAZON_US', label: 'Amazon US', channelCode: 'amazon_fbm', country: 'US', implemented: true },
  { key: 'SHOPIFY_US', label: 'Shopify US', channelCode: 'shopify_iwa', country: 'US', implemented: false },
  { key: 'WALMART_US', label: 'Walmart US', channelCode: 'walmart', country: 'US', implemented: false },
];

export function getChannel(key: string): StockPushChannel | undefined {
  return STOCK_PUSH_CHANNELS.find((c) => c.key === key);
}

/** STOCK kovasinda secilebilir US depo kaynaklari. */
export const STOCK_WAREHOUSES = ['CG_MDN', 'CG_SHUKRAN', 'NJ', 'SHOWROOM'] as const;
export type StockWarehouse = (typeof STOCK_WAREHOUSES)[number];
export const WAREHOUSE_LABELS: Record<StockWarehouse, string> = {
  CG_MDN: 'CG (MDN)',
  CG_SHUKRAN: 'CG (Shukran)',
  NJ: 'Somerset',
  SHOWROOM: 'Fairfield',
};
