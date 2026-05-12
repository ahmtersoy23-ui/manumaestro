# ManuMaestro Audit — Sonraki Session Handoff

Bağımsız audit (2026-05-12, `AUDIT_2026_05_12_FRESH.md`) sonucunda
**3 HIGH** maddesi açık. Bu maddeler bu session'da ele alınamadı çünkü:

- **H1** çok büyük (~88 route), session'a sığmıyor
- **H2** browser-level manuel test gerektiriyor, otomatik garanti edilemez
- **H4** Apps-SSO koordinasyonu gerektirir, ayrı repo

Her biri için bağımsız bir Claude Code session'ında çalıştırılmak üzere
hazırlanmış prompt'lar aşağıda.

---

## H1 — withRoute Migration (Kalan ~88 route)

### Prompt

```
ManuMaestro Next.js 16 + Prisma 7 app'inde API route'ları HOF pattern'i
'lib/api/withRoute.ts'e taşıyacağız. Audit ile başlatılan H1 maddesinin
batch 2+'sı. Shipments domain'i (8/8 route) zaten taşındı, commit `46bbb6c`
ile gönderildi. Pattern oturmuş durumda.

CONTEXT:
- Repo: /Users/ahmetersoy/apps/manumaestro
- 88 route hâlâ eski boilerplate'te (try/catch + ham auth + rate-limit yok
  veya manuel)
- withRoute helper: lib/api/withRoute.ts — auth, rate limit, try/catch +
  errorResponse standartlaştırıyor
- Reference commit (örnek pattern): `46bbb6c` — shipments domain
  - shipment'lar gibi özel role sistemi olan domain'lerde
    `withRoute({ skipAuth: true, rateLimit: 'write' })` + domain-spesifik
    auth handler içinde (örn. `requireShelfAction`, `requireShipmentAction`)
  - skipAuth: false (default) — base auth + roles filter'ı yeterli olan
    route'lar için
- Audit rapor: AUDIT_2026_05_12_FRESH.md (H1 ile bağlantılı bölüm)

DOMAIN BREAKDOWN (her birini ayrı atomik commit olarak işle):

1. depolar/ — 41 route (en büyük). Bu kendisi 4-5 alt batch'e bölünmeli:
   - depolar/route.ts + depolar/[code]/route.ts (ana lobby)
   - depolar/[code]/raflar/* (raf işlemleri, ~8 route)
   - depolar/[code]/siparis/* (sipariş, ~10 route)
   - depolar/[code]/sayim/* (sayım, ~6 route)
   - depolar/[code]/hareketler/* + diğer (~10 route)
   - depolar/[code]/koli/* + tekil/* + unmatched/* + transfer (~7 route)

2. admin/ — 10 route. requireRole(['admin']) kullanıyor — withRoute roles
   parametresi ile basit refactor (skipAuth değil, roles: ['admin']).

3. stock-pools/ — 9 route. requireSuperAdmin kullanıyor; super-admin
   audit-log'lu olduğu için handler içinde tutulmalı (skipAuth: true).

4. requests/ — 5 route. requireRole + dashboard cache revalidateTag çağrıları
   zaten var; withRoute ile sarman lazım.

5. labels/, export/, products/, manufacturer/ — küçük batch'ler (~13 toplam)

6. Tek dosyalı kalanlar (sku-master, audit-logs, marketplaces, vb.) —
   diğer batch'lerden sonra tek seferde.

KURALLAR:
- Her batch'i ayrı commit + push + smoke test (271 test yeşil).
- Domain-spesifik auth (requireShipmentX, requireShelfX, requireSuperAdmin,
  requireRole) handler içinde kalır. withRoute SADECE try/catch + rate
  limit + (mümkünse base auth) standartlaştırması için.
- response shape: successResponse() / createdResponse() / errorResponse()
  helper'larını kullan (lib/api/response.ts).
- Zod validation handler içinde kalır (withRoute schema validation yapmıyor).
- Status code'lar:
  * 400: validation hatası, business rule ihlali
  * 404: kaynak bulunamadı
  * NextResponse.json({ success: false, error: '...' }, { status: N })
    pattern'i validation hatası için OK; helper kullanmak da OK.
- Type generics: withRoute<{ id: string }> formatı (TS strict gerekli).
- Test: her batch sonrası `npx tsc --noEmit && npm run lint && npm test &&
  npm run build`.
- Kullanıcı onay vermeden manuel browser test yapma; sadece automated.

PATTERN ÖRNEK (shipments/[id]/route.ts'ten):

ESKİ:
  export async function PATCH(request: NextRequest, { params }: Params) {
    try {
      const { id } = await params;
      const authResult = await requireShipmentAction(request, ...);
      if (authResult instanceof NextResponse) return authResult;
      // ... logic
      return NextResponse.json({ success: true, data: ... });
    } catch (error) {
      return errorResponse(error, 'Sevkiyat güncellenemedi');
    }
  }

YENİ:
  export const PATCH = withRoute<{ id: string }>(
    { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sevkiyat güncellenemedi' },
    async ({ request, params }) => {
      const { id } = params;
      const authResult = await requireShipmentAction(request, ...);
      if (authResult instanceof NextResponse) return authResult;
      // ... logic
      return successResponse(data);
    }
  );

İŞ SIRASI:
1. Önce 1 küçük batch (admin/ veya requests/) ile pattern'i doğrula.
2. Sonra depolar/'ı 4-5 alt-batch'e böl, her birini ayrı commit.
3. Diğer küçük batch'ler.
4. Her batch sonu memory güncelle: project_audit_fresh_2026_05_12.md.

İSTENEN İLK ADIM:
admin/ domain'i (10 route) ile başla. requireRole(['admin']) pattern'i
withRoute'un native roles filter'ına en iyi uyuyor. skipAuth: false +
roles: ['admin'] — boilerplate ciddi azalır. Smoke test geçince
depolar/'a geç.
```

---

## H2 — Nonce-Based CSP Migration

### Prompt

```
ManuMaestro Next.js 16 + React 19 app'inde Content-Security-Policy
'unsafe-inline'siz nonce-based hale getirilecek. Bu CHANGE PRODUCTION
ENVIRONMENT BEHAVIOR — browser console'da manuel smoke test ZORUNLU.

CONTEXT:
- Repo: /Users/ahmetersoy/apps/manumaestro
- Mevcut CSP: next.config.ts:32-48
  - script-src 'self' 'unsafe-inline' (production'da)
  - style-src 'self' 'unsafe-inline'
- Audit: AUDIT_2026_05_12_FRESH.md H2 maddesi
- Risk: nonce eksik script/style'lar üretimde bloklanırsa kullanıcı UI'ı
  kırılır. Test edilmesi gereken bileşenler:
  - Sentry (instrumentation-client.ts) — auto-injects scripts
  - react-hot-toast — inline style kullanabilir
  - Tailwind v4 — runtime inline style yok ama emin ol
  - PWA service worker register (components/PWARegister.tsx)
  - next/script kullanan herhangi bir component (varsa)

YAKLAŞIM (Önerilen — Report-Only ile güvenli geçiş):

ADIM 1 — Report-Only header ekle (production etkisi YOK):
  - middleware.ts'te nonce üret: `const nonce = Buffer.from(crypto.randomUUID()).toString('base64')`
  - response.headers.set('Content-Security-Policy-Report-Only', sıkı_csp_nonce_ile)
  - Mevcut enforce CSP (next.config.ts) DOKUNULMASIN
  - Production deploy → 1 hafta gözlem
  - Browser console'da CSP violation log'larına bakılır

ADIM 2 — Tüm violation'lar fixlendiğinde enforce'a geç:
  - next.config.ts CSP'sini kaldır
  - middleware.ts'te `Content-Security-Policy` (Report-Only değil)
  - script-src: `'self' 'nonce-${nonce}' 'strict-dynamic'`
    - 'strict-dynamic' Next.js RSC için zorunlu
  - style-src: `'self' 'nonce-${nonce}'` (veya 'unsafe-inline' bırak başta)
  - x-nonce request header'a koy: `requestHeaders.set('x-nonce', nonce)`
  - Layout/page.tsx'lerde `headers().get('x-nonce')` ile oku
  - <Script>/<style> componentlerine nonce={nonce} prop'u

REFERANS: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy

DOĞRULAMA:
1. Lokal: `npm run build && npm run start`
2. Browser'da production-like server'ı gez:
   - Dashboard, depolar, shipments, seasonal pages
   - Modal'lar açılsın (notify, confirm, input)
   - QR scanner aç (depolar/[code]/raf/[shelfCode]/sayim — zxing kamera)
   - Print modal aç (shipments/[id]/page.tsx — barcode + PDF)
3. Browser console'da "Content Security Policy" violation arama
4. Sentry tunnel route bağlantısı çalışıyor mu

GERÇEKLEŞTİRME:
- Önce ADIM 1 yap. Production'a deploy. Kullanıcı 3-7 gün boyunca normal
  kullanımda console kontrol etsin.
- Kullanıcı OK derse ADIM 2'ye geç.

NE YAPMA:
- Direkt enforce moduyla deploy etme — kullanıcı UI'ı kırılır.
- middleware'i değiştirirken /auth/bootstrap, /api/health, /api/sentry-verify
  bypass'larını bozma.
- Mevcut HSTS/X-Frame-Options/Referrer-Policy header'larına dokunma.

İSTENEN İLK ADIM:
ADIM 1 implement et. Report-Only CSP middleware'de. Production deploy +
kullanıcı için gözlem talimatı.
```

---

## H4 — SSO Token Cache Replay Window Daraltma

### Prompt

```
ManuMaestro + Apps-SSO arasındaki Bearer token verify cache'inde 5dk
replay window var. Audit bulgusu: leak olan token süre dolana kadar
kullanılabilir, IP/UA binding yok. Bu iş İKİ repo'yu etkiliyor.

CONTEXT:
- ManuMaestro: /Users/ahmetersoy/apps/manumaestro
- Apps-SSO: /Users/ahmetersoy/apps/apps-sso
- Cache lokasyonu: manumaestro lib/auth/verify.ts (ssoCache Map, 5dk TTL,
  key = token string)
- Apps-SSO verify endpoint: /api/auth/verify (POST { token, app_code })
- Audit: AUDIT_2026_05_12_FRESH.md H4 maddesi

İKİ ALTERNATİF YAKLAŞIM:

A) DAR — Cache TTL'i 5dk → 60sn azalt (manumaestro tek başına):
  - lib/auth/verify.ts'te CACHE_TTL_MS = 60_000
  - Apps-SSO koordinasyonu gerek YOK
  - Etki: token leak window 5dk → 1dk
  - Trade-off: %5x daha fazla SSO verify roundtrip (her dakikada bir
    yerine 5 dakikada bir)

B) GENİŞ — Client binding ekle (her iki repo):
  - Manumaestro lib/auth/verify.ts: cache key = `${token}|${ip}|${ua_hash}`
  - Apps-SSO: verify endpoint'i de aynı binding'i kontrol etsin (anti-replay
    on server)
  - Apps-SSO'da yeni response field: token JTI veya binding token
  - Manumaestro nin uzaklaştırılması koordineli olmalı

ÖNERİLEN: A — 60sn TTL. Hızlı, tek repo, koordinasyon yok. Etki yüzde 80
yeterli (1dk replay window pratik bir saldırı için çok kısa). B'yi ileride
düşün eğer compliance gereksinim olursa.

ADIM A (basit):
1. lib/auth/verify.ts dosyasındaki CACHE_TTL_MS değerini bul
2. 5 * 60_000 (5dk) → 60_000 (1dk)
3. SSO_VERIFY_URL fetch endpoint'i artık 5x sıklıkta çalışacak —
   Apps-SSO load test ile teyit (Apps-SSO health endpoint hâlâ yanıt
   veriyor mu).
4. Production deploy + 1 hafta gözlem (latency etki)

ADIM B (kompleks — eğer A yeterli değilse):
1. Apps-SSO /api/auth/verify endpoint'ine `client_binding: { ip, ua_hash }`
   parametresi ekle (optional, geri uyumlu)
2. Apps-SSO'da binding'i token'a bağla (DB veya in-memory store)
3. İkinci verify request farklı binding ile gelirse → fail
4. Manumaestro lib/auth/verify.ts'te request'ten ip+ua çek, send et
5. Cache key'e binding hash ekle

NE YAPMA:
- Cache'i tamamen kaldırma. Her request'te SSO'ya gidersen latency 3-4x artar
  ve Apps-SSO load'u patlar.
- Apps-SSO breaking change yapma — backward compatible olmalı.

İSTENEN İLK ADIM:
ADIM A yap. CACHE_TTL_MS = 60_000. Smoke test + production deploy.
1 hafta gözlem sonrası B'ye gerek var mı değerlendir.
```

---

## Audit Genel Durum (Bu Session Sonu)

| Severity | Başlangıç | Şu an | Detay |
|---|---|---|---|
| CRITICAL | 5 | **0** | Hepsi kapandı |
| HIGH | 8 | **3** | H1 (batch 1 yapıldı, ~88 kaldı), H2, H4 |
| MEDIUM | 15 | **12** | M9, M10, M12 kapandı |
| LOW | 10 | 10 | Dokunulmadı |

**Kapanan kritikler:** C1-C5, M9, M10, M12, H3, H5, H6, H7, H8.
**Tamamlanan commit'ler:** 13 (`544f1f8` → `b3c9078`).

**Memory:** `project_audit_fresh_2026_05_12.md` — tüm durum güncel.
