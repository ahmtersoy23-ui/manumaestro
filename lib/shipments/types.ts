/**
 * Sevkiyat detay sayfası tipler — page.tsx'ten extract edildi.
 * Komponent parçalanması (D refactor) sırasında ortak kullanım için ayrıldı.
 */

export interface BoxFormData {
  iwasku?: string | null;
  fnsku?: string | null;
  productName?: string | null;
  productCategory?: string | null;
  marketplaceCode?: string | null;
  destination?: string;
  quantity: number;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  weight?: number | null;
}

export interface ShipmentItem {
  id: string;
  iwasku: string;
  quantity: number;
  desi: number | null;
  marketplaceId: string | null;
  marketplace: { id: string; name: string; code: string } | null;
  recommendedDestination: string | null;
  productName: string;
  productCategory: string;
  fnsku: string | null;
  reserveId: string | null;
  packed: boolean;
  sentAt: string | null;
  createdAt: string;
}

export interface ShipmentBox {
  id: string;
  shipmentItemId: string | null;
  boxNumber: string;
  iwasku: string | null;
  fnsku: string | null;
  productName: string | null;
  productCategory: string | null;
  marketplaceCode: string | null;
  destination: string;
  quantity: number;
  width: number | null;
  height: number | null;
  depth: number | null;
  weight: number | null;
  labelPrinted: boolean;
  createdAt: string;
}

/**
 * Pazar yeri kodundan ülke kodu mapping — FNSKU SKU master'da
 * (iwasku, country_code) ikilisi ile lookup edilir.
 */
export const MKT_CODE_TO_COUNTRY: Record<string, string> = {
  AMZN_US: 'US',
  AMZN_CA: 'CA',
  AMZN_UK: 'UK',
  AMZN_AU: 'AU',
  AMZN_EU: 'FR',
};
