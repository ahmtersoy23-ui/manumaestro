/**
 * Veeqo etiket modalı için kargo maliyeti KIYAS verisi (CargoLens, read-only).
 * Amaç: Veeqo canlı US oranı bariz ucuzsa operatör diğerlerine bakmadan alsın.
 *
 *  - trUs:       rate_cards (TR→US FedEx tarifesi) — siparişin desi'sine göre Eco/Pri.
 *                "Türkiye'den direkt yollasak ne tutardı" referansı.
 *  - fedexIzmir: us_shipments (FedEx Izmir hesabı, US-içi geçmiş) — benzer ağırlıkta
 *                ortalama fiili maliyet. Canlı teklif değil, tarihsel referans.
 *
 * Best-effort: CargoLens erişilemezse/sorgu patlarsa null döner; rates akışını BOZMAZ.
 */

import { queryCargolens } from '@/lib/db/prisma';

const MIN_STATE_SAMPLES = 5; // eyalet bazlı için yeterli örnek; altında genele düş

export interface ShippingBenchmark {
  trUs: { desi: number; eco: number | null; pri: number | null } | null;
  fedexIzmir: { avg: number; n: number; lowLb: number; highLb: number; scope: 'state' | 'genel'; state: string | null } | null;
}

export async function getShippingBenchmark(input: { desi: number | null; weightLb: number | null; state?: string | null }): Promise<ShippingBenchmark> {
  const out: ShippingBenchmark = { trUs: null, fedexIzmir: null };

  // 1) TR→US FedEx tarifesi — siparişin desi'sine eşit/üstü ilk satır (ceiling)
  if (input.desi && input.desi > 0) {
    try {
      const rows = (await queryCargolens(
        `SELECT desi::float8 AS desi, eco_usd::float8 AS eco, pri_usd::float8 AS pri
         FROM rate_cards WHERE country_code = 'US' AND desi >= $1
         ORDER BY desi ASC LIMIT 1`,
        [input.desi],
      )) as Array<{ desi: number; eco: number | null; pri: number | null }>;
      // desi tavanı aşıldıysa en büyük satırı al
      const row = rows[0] ?? (await queryCargolens(
        `SELECT desi::float8 AS desi, eco_usd::float8 AS eco, pri_usd::float8 AS pri
         FROM rate_cards WHERE country_code = 'US' ORDER BY desi DESC LIMIT 1`,
      ))[0];
      if (row) out.trUs = { desi: row.desi, eco: row.eco, pri: row.pri };
    } catch { /* best-effort */ }
  }

  // 2) FedEx Izmir US-içi geçmiş — benzer ağırlık bandında ort. net maliyet.
  //    Önce hedef EYALET bazlı; yeterli örnek (≥MIN) yoksa GENEL'e düş (scope ile belirtilir).
  if (input.weightLb && input.weightLb > 0) {
    const low = Math.round(Math.max(0, input.weightLb - 2) * 10) / 10;
    const high = Math.round((input.weightLb + 2) * 10) / 10;
    const state = input.state?.trim() || null;
    const run = async (st: string | null) => {
      const rows = (await queryCargolens(
        `SELECT round(avg(net_charge_usd), 2)::float8 AS avg, count(*)::int AS n
         FROM us_shipments
         WHERE net_charge_usd > 0 AND rated_weight_lbs BETWEEN $1 AND $2
         ${st ? 'AND recipient_state = $3' : ''}`,
        st ? [low, high, st] : [low, high],
      )) as Array<{ avg: number | null; n: number }>;
      return rows[0];
    };
    try {
      let scope: 'state' | 'genel' = 'genel';
      let r = state ? await run(state) : null;
      if (r && r.n >= MIN_STATE_SAMPLES && r.avg != null) {
        scope = 'state';
      } else {
        r = await run(null); // genele düş
        scope = 'genel';
      }
      if (r?.n && r.n > 0 && r.avg != null) {
        out.fedexIzmir = { avg: r.avg, n: r.n, lowLb: low, highLb: high, scope, state: scope === 'state' ? state : null };
      }
    } catch { /* best-effort */ }
  }

  return out;
}
