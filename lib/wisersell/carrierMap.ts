/**
 * Kargo tracking numarasının prefix'inden Wisersell carrierId'sini türetir.
 * Wisersell /api/carriers integer id'leri (2026-06-04 doğrulanmış):
 *   2=UPS, 3=USPS, 4=FedEx, 14=Fedex Package, 32=Amazon Shipping, 34=Chit Chats.
 *
 * ManuMaestro order_labels'ta carrier kolonu yok → tracking biçiminden çıkarılır.
 * Belirsizse null döner; çağıran operatöre sorar / default uygular.
 */

export const WISERSELL_CARRIER_IDS = {
  UPS: 2,
  USPS: 3,
  FEDEX: 4,
  AMAZON: 32,
  CHIT_CHATS: 34,
} as const;

export function carrierIdFromTracking(tracking: string | null | undefined): number | null {
  if (!tracking) return null;
  const t = tracking.trim().toUpperCase().replace(/\s+/g, '');

  // UPS: 1Z... veya T + 10 hane
  if (/^1Z[0-9A-Z]{16}$/.test(t) || /^1Z/.test(t)) return WISERSELL_CARRIER_IDS.UPS;

  // USPS: 9400/9205/9407/9270/92.. , 420+zip, EC/EJ..US, CP..US
  if (/^9[0-9]{15,21}$/.test(t) || /^420\d{5}9[0-9]{15,21}$/.test(t) || /^(EC|EJ|LC|CP)[0-9]{9}US$/.test(t)) {
    return WISERSELL_CARRIER_IDS.USPS;
  }

  // Amazon: TBA + 12 hane
  if (/^TBA[0-9]{12}$/.test(t) || /^TBA/.test(t)) return WISERSELL_CARRIER_IDS.AMAZON;

  // FedEx: 12 / 15 / 20 hane sadece rakam, veya 96 ile başlayan 22 hane
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t) || /^\d{20}$/.test(t) || /^96\d{20}$/.test(t)) {
    return WISERSELL_CARRIER_IDS.FEDEX;
  }

  return null;
}
