# ManuMaestro Audit — Sonraki Session Handoff

Bağımsız audit (2026-05-12, `AUDIT_2026_05_12_FRESH.md`) sonucunda
**1 HIGH** maddesi açık (H1 + H4 kapandı, 2026-05-13).

- ~~**H1** (withRoute migration)~~ — **KAPANDI** (2026-05-13). 12 batch'te
  tamamlandı, depolar/ domain'i dahil tüm 41 route migrate edildi
  (batch 7-12). Kasıtlı atlanan: auth/login (custom shape), sentry-verify
  (throw test).
- **H2** browser-level manuel test gerektiriyor (CSP nonce migration).
- ~~**H4** SSO token cache TTL~~ — **KAPANDI** (2026-05-13, `b37ce61`).
  Plan A: 5dk → 1dk. Production deploy + 1 hafta SSO load gözlem.

Her biri için bağımsız bir Claude Code session'ında çalıştırılmak üzere
hazırlanmış prompt'lar aşağıda.

---

## ~~H1 — withRoute Migration: depolar/ domain (41 route)~~  KAPANDI 2026-05-13

> Tüm 41 route 6 sub-batch'te (batch 7-12) migrate edildi. Aşağıdaki prompt
> referans için korunuyor — gelecekte benzer domain migration'larında pattern
> rehberi olarak kullanılabilir.

### Eski Prompt (kapanmış)

### Prompt

```
ManuMaestro Next.js 16 + Prisma 7 app'inde API route'ları HOF pattern'i
`lib/api/withRoute.ts`e taşıyacağız. Audit H1'in son ve en büyük domain'i:
**depolar/** (41 route). Önceki 6 batch tamamlandı (shipments + admin +
stock-pools + requests + labels/export/products/manufacturer + tek
dosyalılar). H1 adoption %10 → %67. Depolar bitince ~%100.

CONTEXT:
- Repo: /Users/ahmetersoy/apps/manumaestro
- Branch: main
- 41 depolar/ route hâlâ eski boilerplate'te (verifyAuth + try/catch +
  errorResponse manuel + rate-limit yok veya manuel)
- withRoute helper: lib/api/withRoute.ts — auth, rate limit, try/catch +
  errorResponse standartlaştırıyor
- Reference commit'ler:
  * shipments domain (46bbb6c) — özel destinasyon-bazlı yetki pattern'i
  * admin domain (6a8a77a) — `roles: ['admin']` native filter
  * stock-pools (77fb3ce) — requireSuperAdmin skipAuth: true
  * requests (4bac2e5) — revalidateTag handler içinde korundu
  * Memory: project_audit_fresh_2026_05_12.md
- Depolar domain auth pattern'i: `requireShelfView`, `requireShelfAction`
  ve depo-spesifik permission (lib/auth/requireShelfRole.ts).
  withRoute'un generic roles filter'ı KAPSAMAZ — handler içinde tutulmalı
  (skipAuth: true pattern'i, shipments gibi).

SUB-BATCH'LER (her birini AYRI atomik commit + push):

1. **depolar lobby (~2 route)**:
   - depolar/route.ts (depo listesi)
   - depolar/[code]/route.ts (depo detayı)

2. **raflar (~8 route)**:
   - depolar/[code]/raf/* ve depolar/[code]/raflar/*

3. **siparis (~10 route)**:
   - depolar/[code]/siparis/* (lobby, marketplace, stage, [id], yeni, etc.)
   - Bu en kompleks alt-domain; FIFO/Allocation/ShipModal kontrolü var

4. **sayim (~6 route)**:
   - depolar/[code]/sayim/* (CycleCount akışı)

5. **hareketler + diğer (~10 route)**:
   - depolar/[code]/hareketler/* (ShelfMovement)
   - Tekil olarak kalan endpoint'ler

6. **koli/tekil/unmatched/transfer (~7 route)**:
   - depolar/[code]/koli/*
   - depolar/[code]/tekil/*
   - depolar/[code]/unmatched/*
   - depolar/[code]/transfer/*

İLK ADIM:
`find app/api/depolar -name "route.ts"` ile gerçek envanteri al, alt-batch'leri
doğrula (sayım tahminden farklıysa düzenle). Sonra **sub-batch 1 (lobby)** ile
başla — küçük + pattern'i doğrula.

KURALLAR (önceki batch'lerden öğrenilenler):
- requireShelfX domain-spesifik → `withRoute({ skipAuth: true, rateLimit: ... })`
  + handler içinde requireShelfX (shipments pattern'i ile aynı)
- try/catch + errorResponse → `withRoute fallbackMessage`
- Response shape:
  * `successResponse()` / `createdResponse()` — DATA wrapper kullananlar için
  * Manuel `NextResponse.json({ success: true, ... })` — flat shape (pagination,
    summary, extra top-level fields) için; ZORUNLU KORUN
- Validation hatası: `NextResponse.json({ success: false, error, details }, { status: 400 })`
- Generic params: `withRoute<{ code: string }>` veya `<{ code: string; id: string }>`
- Zod validation handler içinde kalır
- revalidateTag çağrıları varsa handler içinde aynen kalır
- `ctx.user` `user!` ile kullanılır (skipAuth: true ise undefined olabilir,
  ama domain auth gates kullanıcıyı handler içinde alır)
- Logger çağrıları, transaction'lar, business logic AYNEN KORUN

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

VALIDATION (her batch sonrası ZORUNLU):
  npx tsc --noEmit && npm run lint && npm test -- --run && npm run build
Hepsi yeşil olmadan commit YAPMA. Test sayısı: 271 (azalmamalı).

COMMIT MESSAGE FORMAT:
  refactor(audit-fresh H1 batch N): depolar/<sub-domain> withRoute migration

  X route withRoute pattern'ine taşındı (Y handler):
  - ... liste ...

  Pattern: ... (requireShelfX/Y inline, vb.)
  Audit H1 adoption %X → %Y (N/98 handler).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

Push: `git push origin main` her batch sonrası — sıradaki sub-batch
bağımsız çalışabilsin.

MEMORY GÜNCELLEME:
Tüm depolar bittikten sonra `project_audit_fresh_2026_05_12.md`'nin "Kalan
kritikler" bölümünü güncelle (H1 → kapandı, H1 batch tablosu).

Başlamadan önce: `git log --oneline -10` ile son commit'leri kontrol et,
working tree clean olduğunu doğrula.

KASITLI ATLANANLAR (depolar/'da değil, referans için):
- auth/login: custom error shape, /auth/bootstrap kontratı
- sentry-verify: ?throw=1 Sentry'e propagate olmalı
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

## ~~H4 — SSO Token Cache Replay Window Daraltma~~  KAPANDI 2026-05-13

> Plan A uygulandı: `lib/auth/verify.ts` `SSO_CACHE_TTL` 5 dakika → 1 dakika
> (`b37ce61`). Production deploy + 1 hafta SSO load gözlem sonrası B'ye
> gerek var mı değerlendirilecek. Aşağıdaki prompt arşiv için korunuyor.

### Eski Prompt (kapanmış)

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

## Audit Genel Durum (Bu Session Sonu — 2026-05-13)

| Severity | Başlangıç | Şu an | Detay |
|---|---|---|---|
| CRITICAL | 5 | **0** | Hepsi kapandı |
| HIGH | 8 | **1** | H1 + H4 kapandı bu session'da, kalan: H2 |
| MEDIUM | 15 | **12** | M9, M10, M12 kapandı |
| LOW | 10 | 10 | Dokunulmadı |

**Kapanan kritikler:** C1-C5, M9, M10, M12, H1, H3, H4, H5, H6, H7, H8.

**H1 batch'leri tamamlanan:**
- Batch 1 (shipments): `46bbb6c`
- Batch 2 (admin): `6a8a77a`
- Batch 3 (stock-pools): `77fb3ce`
- Batch 4 (requests): `4bac2e5`
- Batch 5 (labels/export/products/manufacturer): `e3ef8ba`
- Batch 6 (tek dosyalılar): `361e8f5`
- Batch 7 (depolar lobby): `fff4f4a`
- Batch 8 (depolar/raflar): `c438649`
- Batch 9 (depolar/siparis): `2256aea`
- Batch 10 (depolar/sayim): `d5c765f`
- Batch 11 (depolar/hareketler): `8b6547f`
- Batch 12 (depolar misc): `00985e4`

**H1 KAPANDI** (2026-05-13) — kasıtlı atlananlar: auth/login (custom error
shape, /auth/bootstrap kontratı), sentry-verify (?throw=1 Sentry'e propagate).

**Memory:** `project_audit_fresh_2026_05_12.md` — tüm durum güncel.
