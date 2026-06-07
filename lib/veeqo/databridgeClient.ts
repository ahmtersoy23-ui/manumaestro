/**
 * DataBridge Veeqo routing endpoint'lerine server-to-server çağrı.
 * Veeqo ile konuşan TEK yer DataBridge; ManuMaestro iş mantığını yapar,
 * bu uçları x-internal-api-key ile tetikler. (wisersell/databridgeClient ile aynı patern.)
 *
 * Env (sunucu .env / deploy):
 *   DATABRIDGE_API_URL          (varsayılan http://localhost:3008/api)
 *   DATABRIDGE_INTERNAL_API_KEY (DataBridge INTERNAL_API_KEY ile aynı olmalı)
 */

function getConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.DATABRIDGE_API_URL || 'http://localhost:3008/api').replace(/\/$/, '');
  const apiKey = process.env.DATABRIDGE_INTERNAL_API_KEY || '';
  if (!apiKey) throw new Error('DATABRIDGE_INTERNAL_API_KEY yapılandırılmamış');
  return { baseUrl, apiKey };
}

async function post(path: string, body: unknown, timeoutMs = 40_000): Promise<unknown> {
  const { baseUrl, apiKey } = getConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { success?: boolean }).success === false) {
    throw new Error((data as { error?: string }).error || `DataBridge ${path} HTTP ${res.status}`);
  }
  return data;
}

export interface VeeqoQuote {
  rate_id: string;
  service_name: string;
  service_carrier: string;
  total_charge: string;
  delivery_estimate?: string;
  /** booking'de gönderilmesi gereken value-added-service varsayılanları (ücretsiz) */
  options?: Record<string, string>;
  /** operatörün seçebileceği ek servisler (confirmation/sigorta vb.) */
  serviceOptions?: Array<{ key: string; label?: string; type?: string; values?: Array<{ value: string; label?: string; price?: number | string }> }>;
}

export interface VeeqoRatesResponse {
  remoteShipmentId: string;
  requestToken: string;
  expiresAt: string;
  quotes: VeeqoQuote[];
  destState?: string | null;
}

export interface VeeqoParcelInput {
  weight: number;
  weight_unit?: 'lb' | 'kg' | 'oz' | 'g';
  length: number;
  width: number;
  height: number;
  dimension_unit?: 'in' | 'cm';
}

/** Veeqo'dan kargo oranlarını çek (Amazon order no ile). Etiket ALMAZ. */
export async function getVeeqoRates(
  amazonOrderNumber: string,
  parcel: VeeqoParcelInput,
  opts?: { contents?: string; warehouse?: string },
): Promise<VeeqoRatesResponse> {
  const data = (await post('/veeqo-routing/rates', {
    amazonOrderNumber, parcel, contents: opts?.contents, warehouse: opts?.warehouse,
  })) as Partial<VeeqoRatesResponse>;
  return {
    remoteShipmentId: data.remoteShipmentId ?? '',
    requestToken: data.requestToken ?? '',
    expiresAt: data.expiresAt ?? '',
    quotes: data.quotes ?? [],
    destState: data.destState ?? null,
  };
}

export interface VeeqoShipTo {
  name: string;
  line1: string;
  line2?: string;
  town: string;
  county?: string;
  postcode: string;
  country_code: string;
  phone?: string;
}

/**
 * Amazon-DIŞI (standalone) oran çek — adres BİZ veririz (Veeqo'da sipariş yok).
 * is_amazon_order:false → Buy Shipping push YOK, Veeqo Stripe kartından faturalanır.
 */
export async function getVeeqoRatesStandalone(
  toAddress: VeeqoShipTo,
  parcel: VeeqoParcelInput,
  opts?: { contents?: string; warehouse?: string; reference?: string },
): Promise<VeeqoRatesResponse> {
  const data = (await post('/veeqo-routing/rates', {
    toAddress, parcel, reference: opts?.reference, contents: opts?.contents, warehouse: opts?.warehouse, isAmazonOrder: false,
  })) as Partial<VeeqoRatesResponse>;
  return {
    remoteShipmentId: data.remoteShipmentId ?? '',
    requestToken: data.requestToken ?? '',
    expiresAt: data.expiresAt ?? '',
    quotes: data.quotes ?? [],
    destState: data.destState ?? null,
  };
}

export interface VeeqoBookResponse {
  shipmentId: string;
  trackingNumber: string;
  serviceName?: string;
  serviceCarrier?: string;
  totalCharge?: { value: number; unit: string };
  labelBase64: string;
  labelFormat: string;
}

/** Seçilen oranla etiketi SATIN AL — GERÇEK PARA. Tracking + label(base64) döner. */
export async function bookVeeqoLabel(input: {
  remoteShipmentId: string;
  rateId: string;
  requestToken?: string;
  labelFormat?: 'PDF' | 'PNG' | 'ZPL' | 'JPEG';
  options?: Record<string, string>;
}): Promise<VeeqoBookResponse> {
  return (await post('/veeqo-routing/book', input)) as VeeqoBookResponse;
}

/** Yanlış/test etiketini iptal et (ücret iadesi). */
export async function cancelVeeqoLabel(shipmentId: string): Promise<void> {
  await post('/veeqo-routing/cancel', { shipmentId });
}
