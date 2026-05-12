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
