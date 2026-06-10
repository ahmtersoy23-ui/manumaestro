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
  opts: { dryRun: boolean; alert?: string },
): Promise<PushResponse> {
  const { baseUrl, apiKey } = getConfig();
  const all: PushResultRow[] = [];
  let alertSent = false;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const body = {
      country: 'US',
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
