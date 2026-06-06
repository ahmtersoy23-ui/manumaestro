/**
 * DataBridge routing endpoint'lerine server-to-server çağrı.
 * Wisersell ile konuşan TEK yer DataBridge; ManuMaestro iş mantığını yapar,
 * bu uçları x-internal-api-key ile tetikler.
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

async function post(path: string, body: unknown): Promise<unknown> {
  const { baseUrl, apiKey } = getConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { success?: boolean }).success === false) {
    throw new Error((data as { error?: string }).error || `DataBridge ${path} HTTP ${res.status}`);
  }
  return data;
}

/** Wisersell sipariş(ler)ini "Kargoya Hazır" yapar. */
export async function markWisersellReady(ids: number[]): Promise<{ affected: number[]; count: number }> {
  const data = await post('/wisersell-routing/mark-ready', { ids }) as { affected?: number[]; count?: number };
  return { affected: data.affected ?? [], count: data.count ?? 0 };
}

/** Wisersell siparişini tracking ile harici kapatır (tracking'i marketplace'e push'lar). */
export async function closeWisersellExternal(orderId: number, carrierId: number, trackingCode: string): Promise<void> {
  await post('/wisersell-routing/close', { orderId, carrierId, trackingCode });
}

/** Platform kapama (evrensel son adım) — siparişi Wisersell'de "Açık"tan düşürür. external-close'dan SONRA. */
export async function closeWisersellPlatform(orderId: number): Promise<void> {
  await post('/wisersell-routing/platform-close', { orderId });
}

/** CG export'unda eşleşmeyen iwasku için operatörün girdiği Wayfair part number mapping'ini kalıcılaştırır. */
export async function saveWayfairMapping(partNumber: string, iwasku: string): Promise<void> {
  await post('/wisersell-routing/wayfair-map', { partNumber, iwasku });
}
