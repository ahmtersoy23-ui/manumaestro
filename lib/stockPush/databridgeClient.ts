/**
 * Stok push — DataBridge s2s client. SP-API ile konusan TEK yer DataBridge (Veeqo
 * kalibi). Buyuk diff'leri parcalar (chunk) — her istek sinirli kalsin, timeout
 * yememek icin. Ileride Shopify/Walmart icin ayri adaptor fonksiyonu eklenir.
 */
const CHUNK = 150;
const TIMEOUT_MS = 120_000;

function getConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.DATABRIDGE_API_URL || 'http://localhost:3008/api').replace(/\/$/, '');
  const apiKey = process.env.DATABRIDGE_INTERNAL_API_KEY || '';
  if (!apiKey) throw new Error('DATABRIDGE_INTERNAL_API_KEY yapılandırılmamış');
  return { baseUrl, apiKey };
}

export interface PushItem {
  sku: string;
  quantity: number;
  /** Amazon handling time (lead_time_to_ship_max_days); null/undefined = gönderme */
  handlingDays?: number | null;
}

export interface PushResultRow {
  sku: string;
  status: 'pushed' | 'skipped' | 'dryrun' | 'failed';
  from?: number | null;
  to: number;
  error?: string;
}

export interface PushResponse {
  summary: { total: number; pushed: number; skipped: number; dryrun: number; failed: number };
  results: PushResultRow[];
}

/**
 * Kanal envanterini DataBridge s2s ucu üzerinden push et (chunk'lı).
 * `path` kanala göre: Amazon '/amazon-listings/push', Walmart '/walmart-listings/push'.
 * (country alanı Walmart ucunda yok sayılır.)
 */
export async function pushChannelInventory(
  path: string,
  items: PushItem[],
  opts: { dryRun: boolean; alert?: string; account?: string },
): Promise<PushResponse> {
  const { baseUrl, apiKey } = getConfig();
  const all: PushResultRow[] = [];
  let alertSent = false;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const body = {
      country: 'US',
      // Wayfair ucu account ile hesabı seçer (Amazon/Walmart yok sayar)
      ...(opts.account ? { account: opts.account } : {}),
      dryRun: opts.dryRun,
      // alarmi tek sefer (ilk chunk'ta) gonder — tekrar bildirim olmasin
      ...(opts.alert && !alertSent ? { alert: opts.alert } : {}),
      items: chunk,
    };
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; results?: PushResultRow[] };
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `DataBridge ${path} HTTP ${res.status}`);
    }
    if (opts.alert && !opts.dryRun) alertSent = true;
    if (Array.isArray(data.results)) all.push(...data.results);
  }
  const summary = {
    total: all.length,
    pushed: all.filter((r) => r.status === 'pushed').length,
    skipped: all.filter((r) => r.status === 'skipped').length,
    dryrun: all.filter((r) => r.status === 'dryrun').length,
    failed: all.filter((r) => r.status === 'failed').length,
  };
  return { summary, results: all };
}

export interface WayfairCatalogRow {
  marketplace_sku: string; // supplierPartNumber
  iwasku: string;
}

/**
 * Wayfair dropship katalog (SKU evreni) — DataBridge GET /wayfair-listings/catalog.
 * Sadece iwasku eşleşeni döner (availability için iwasku şart). Stok Push compute'u
 * Wayfair kanalında channel_prices yerine bunu kullanır.
 */
export async function fetchWayfairCatalog(account: string): Promise<WayfairCatalogRow[]> {
  const { baseUrl, apiKey } = getConfig();
  const res = await fetch(`${baseUrl}/wayfair-listings/catalog?account=${encodeURIComponent(account)}`, {
    method: 'GET',
    headers: { 'x-internal-api-key': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    parts?: Array<{ supplierPartNumber: string; iwasku: string | null }>;
  };
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `DataBridge /wayfair-listings/catalog HTTP ${res.status}`);
  }
  return (data.parts ?? [])
    .filter((p): p is { supplierPartNumber: string; iwasku: string } => !!p.iwasku)
    .map((p) => ({ marketplace_sku: p.supplierPartNumber, iwasku: p.iwasku }));
}
