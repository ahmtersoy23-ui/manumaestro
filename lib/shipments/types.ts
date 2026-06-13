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
  destinationLabel: string; // kolon gösterimi: fiziksel destinasyon (Amazon US / CG Depo / NJ Depo)
  productName: string;
  productCategory: string;
  fnsku: string | null;
  /** NL karayolu: Bol.com EAN (bol_sku_mapping.sku). Sadece destinationTab='NL' sevkiyatta dolu; yoksa null → EAN etiketi basılamaz. */
  bolEan: string | null;
  reserveId: string | null;
  packed: boolean;
  sentAt: string | null;
  createdAt: string;
  // SP-API beslemeli zenginleştirme (yalnız FBA-hedefli kalemler; null = uygulanmaz/veri yok)
  fbaWarehouse?: 'US' | 'UK' | 'EU' | 'CA' | 'AU' | null; // hedef FBA deposu
  fbaFulfillable?: number | null;  // Amazon'da satılabilir (kalan) adet
  fbaInbound?: number | null;      // Amazon'a yolda (inbound shipped+receiving)
  fbaFnsku?: string | null;        // Amazon'daki güncel FNSKU
  l30?: number | null;             // hedef pazarda son-30 gün satış
  stockRisk?: boolean;             // #2: kalan < L30/2 → kritik stok (kırmızı + 🚨)
  fnskuStale?: boolean;            // #1: bastığımız fnsku ≠ Amazon güncel fnsku
  inboundCovers?: boolean;         // #3: Amazon'da yolda ≥ talep → "Gönderilene al?" önerisi
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
