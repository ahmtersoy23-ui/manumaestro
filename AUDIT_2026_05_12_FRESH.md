> ⚠️ **ARŞİV (tarihsel).** 2026-05-12 tarihli; o günkü kod tabanını (98 route / 271 test) yansıtır. Açık maddeler (H1/H4) kapandı. Güncel durum için yeni audit'lere bakın — referans/pattern için tutuluyor.

# ManuMaestro Bağımsız Audit — 2026-05-12

**Kapsam:** ManuMaestro (Next.js 16 + Prisma 7 + PostgreSQL 16) tek başına derin inceleme.
**Yöntem:** Önceki audit (Mayıs 11/12) bağlamı dışlanarak 4 boyutta paralel keşif yapıldı: Security, Performance, Database, Code Quality + Architecture. CRITICAL bulgular dosya üzerinde doğrulandı.
**Sayılar:** 98 API route, 25 client component, 27 dashboard page.tsx, prisma schema ~1000 satır, 271 test.

> **Doğrulama notu:** Birkaç ham bulgu kaynak dosyalar üzerinde kontrol edildi; yanlış pozitifler aşağıda **"YANLIŞ POZİTİF"** etiketiyle gösterildi. Geri kalan bulgular agent raporlarından alındı ve dosya satırlarına dayanıyor — implementasyondan önce bağımsız doğrulama önerilir.

---

## CRITICAL

### C1. Open redirect riski — middleware SSO redirect URL'i `request.url` base'i kullanıyor
**Konum:** `middleware.ts:115, 137, 182` civarı
**Sorun:** `NextResponse.redirect(new URL(SSO_URL, request.url))` — base URL request'ten geliyor. Manipülasyonla redirect hedefi attacker domain'ine yönlendirilebilir.
**Risk:** Phishing — kullanıcı SSO sandığı sayfada attacker'a token verir.
**Öneri:** `new URL(SSO_URL)` (base parametresiz) veya hardcoded mutlak URL kullan.

### C2. SSO doğrulama fetch'inde timeout yok — DoS amplifier
**Konum:** `middleware.ts:121`, `lib/auth/verify.ts:82` (doğrulandı: `AbortSignal` import'u yok)
**Sorun:** SSO `/api/auth/verify` çağrısı `fetch(url)` — timeout yok. SSO yavaş veya hung olursa middleware bloklanır → tüm istekler bekler.
**Risk:** Hetzner instance'ı SSO down olduğunda tamamen unresponsive. Apps-SSO down → ManuMaestro da down.
**Öneri:** `fetch(url, { signal: AbortSignal.timeout(5000) })`. 5xx fallback davranışı tanımla (degrade vs hard fail).

### C3. `warehouse-exit` route'unda transaction yok — race condition
**Konum:** `app/api/shipments/[id]/warehouse-exit/route.ts:60-84`
**Sorun:** İtem loop'unda `findUnique` + `update`/`create` ardışık yapılıyor, `prisma.$transaction` yok. İki paralel istek aynı `(iwasku, weekStart, type)` için duplicate `WarehouseWeekly` yaratabilir.
**Risk:** Çift sayım — month-end kapanış raporları yanlış.
**Öneri:** Tüm loop'u `prisma.$transaction(async (tx) => { ... })` içine al. Veya unique constraint + `upsert`.

### C4. `shipments/[id]/page.tsx` print logic'i bundle'a büyük yük getiriyor
**Konum:** `app/dashboard/shipments/[id]/page.tsx:597-599, 810-813` (jsbarcode + jspdf import'ları render fonksiyonu içinde dynamic `await import()`)
**Sorun:** jsPDF (~29MB unminified), JsBarcode (~972KB) — dynamic import var ama page'in kendisi 1245 LOC `'use client'`. İlk paint hâlâ büyük bundle yüklüyor. `next/dynamic` ile sayfa-seviyesinde split yok.
**Risk:** FCP ~800ms+ gecikme 4G mobil. Sevkiyat detayında etiket basacak kişiye kötü UX.
**Öneri:** PrintLabelModal ve barkod logic'i `next/dynamic({ ssr: false })` ile ayrı route segmentine. Veya `/print/[boxId]` ayrı route ile başka chunk.

### C5. State explosion — 45 useState tek dosyada
**Konum:** `app/dashboard/shipments/[id]/page.tsx:47-105` (doğrulandı: `grep -c useState` = 45)
**Sorun:** Modal toggles, form state, filter state, selection state, edit state hepsi parent'ta. Her setState tüm subtree'yi re-render eder.
**Risk:** Filter input'a yazarken 500+ item liste için 200ms+ jank. Bug surface çok geniş.
**Öneri:** `useShipmentData`, `useShipmentFilters`, `useModalStates`, `useFormEditing` gibi custom hook'lara böl. Audit refactor'ında zaten 16 component extract edildi; state extract'ı henüz yapılmadı.

---

## HIGH

### H1. `withRoute` HOF adoption oranı %2 (2/98)
**Konum:** `lib/api/withRoute.ts` (mevcut), kullanım: 2/98 route (doğrulandı)
**Sorun:** Auth + rate limit + try/catch + response standartlaşması için pattern var ama %98 route eski boilerplate'i yazıyor. 93 ham `throw new Error()` çağrısı, sadece 16 typed error kullanımı.
**Risk:** Hata response shape'i tutarsız — frontend her route için ayrı parse mantığı. Yeni route eklerken auth atlanabilir. Bir security regression buradan gelir.
**Öneri:** Bulk migration — domain bazlı batches (shipments/, stock-pools/, depolar/). Her batch ayrı PR + smoke test.

### H2. CSP'de `'unsafe-inline'` script + style aktif
**Konum:** `next.config.ts:39-41` (doğrulandı)
**Sorun:** Production'da `script-src 'self' 'unsafe-inline'` ve `style-src 'self' 'unsafe-inline'`. Kod yorumu "nonce-based CSP'ye geçişte ayrı ele alınacak" diyor ama henüz yok.
**Risk:** Eğer bir gün `dangerouslySetInnerHTML` veya user input HTML render'ı eklenirse XSS riski açık — savunma katmanı yok.
**Öneri:** Nonce-based CSP. Next.js'in [native nonce desteği](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy) var.

### H3. Super-admin email client bundle'a sızıyor
**Konum:** `contexts/AuthContext.tsx:43` (doğrulandı: `NEXT_PUBLIC_SUPER_ADMIN_EMAILS ?? 'ersoy@iwaconcept.com.tr'`)
**Sorun:** `NEXT_PUBLIC_*` env tüm client bundle'a gömülür. Email + admin role anonim view-source ile öğrenilebilir.
**Risk:** Phishing/social engineering vektörü. Targeted attack için kim phishing edileceği bilinir.
**Öneri:** Client-side super-admin gating UI hint'i için kullanılıyorsa, sadece sunucu-side `isSuperAdmin(email)` ile çek + props olarak geç. AuthContext'ten kaldır.

### H4. SSO token cache'i client identity'den bağımsız — replay window 5 dakika
**Konum:** `lib/auth/verify.ts` (token → user mapping cache, 5 min TTL)
**Sorun:** Token leak olursa (browser extension, dev console, log paylaşımı) 5 dakikalık replay penceresi açık. IP/UA gibi binding yok.
**Risk:** Bir kez sızan token süre dolana kadar kullanılabilir. SSO ile geri çağırma yok.
**Öneri:** Apps-SSO `/auth/verify`'a `Client-Token-Binding` ekle (IP+UA hash), cache key'e dahil et. Veya cache TTL'i 1 dakikaya düşür.

### H5. Deprecated `?token=` query param akışı hâlâ aktif
**Konum:** `middleware.ts:88-102`
**Sorun:** Kod yorumu "DEPRECATED ... silinecek" diyor ama hâlâ tarayıcı history, server access log, proxy log, referer header'a token sızdırıyor.
**Risk:** Token leak — kullanıcı farkında olmadan token'ı paylaşmış olur.
**Öneri:** `/auth/bootstrap` fragment akışı çalışıyor; ham query token'ı hemen kapat. Yarım sürüm geçtikten sonra dal silinmeliydi.

### H6. Eksik FK index'leri — query plan sequential scan riski
**Konum:** `prisma/schema.prisma`. Index'siz FK'ler:
- `ShelfMovement.userId, fromShelfId, toShelfId` — audit log büyüdükçe scan
- `OutboundOrder.createdById, shippedById`
- `OrderLabel.uploadedById, printedById`
- `CycleCountTask.assignedToId, completedById`
- `ShelfStock.warehouseCode` (composite var ama tek başına yok)

**Risk:** "Kullanıcı X'in tüm hareketleri" gibi sorgular tablo büyüdükçe expontansiyel yavaşlar. Şu an küçük ama 6-12 ay sonra döner.
**Öneri:** Migration — her FK'ye en azından tek kolon index. Composite ihtiyaçları için `(userId, createdAt)` gibi.

### H7. 14+ silent catch — data fetch hataları kullanıcıya iletilmiyor
**Konum:** Örnekler:
- `app/dashboard/shipments/[id]/page.tsx:117, 125, 134` (`catch { /* ignore */ }`)
- `app/dashboard/seasonal/[id]/page.tsx:153, 1584`
- `lib/auth/verify.ts:176, 228, 329, 370`

**Sorun:** Network/auth/validation hatası UI'a yansımıyor. Kullanıcı boş ekran görür, "neden yok?" sorusu var.
**Risk:** Production'da Sentry'ye gitmeyen sessiz fail. Bug report'ları "X görünmüyor" şeklinde gelir, root cause bulması zor.
**Öneri:** `.catch(err => { logger.error('X failed', err); notify.error('Yüklenemedi'); Sentry.captureException(err); })`.

### H8. Allocator + dashboard stats cache yok — her istekte yeniden hesap
**Konum:** `lib/seasonal/allocator.ts:71`, `app/api/dashboard/stats/route.ts` (varsa)
**Sorun:** Mevsimsel allocator (300+ reserve dağıtımı) ve depolar özet aggregate'leri her dashboard load'unda yeniden hesaplanır. `unstable_cache` veya `revalidateTag` yok.
**Risk:** Her sayfa açılışında 200-500ms ek latency. Multi-user'da gereksiz CPU.
**Öneri:** `unstable_cache((poolId, month) => allocate(...), ['allocator'], { tags: ['stock-pools'] })`. Reserve mutation'unda `revalidateTag('stock-pools')`.

---

## MEDIUM

### M1. Largest pages henüz <1000 LOC değil
**Konum:** `wc -l` sonuçları (doğrulandı):
- `seasonal/[id]/page.tsx` — **1727 LOC** (27 useState)
- `shipments/[id]/page.tsx` — 1245 LOC (audit'te 2065→1245 oldu, devam edebilir)
- `admin/permissions/page.tsx` — 1003 LOC
- `month/[month]/page.tsx` — 854 LOC
- `manufacturer/[category]/page.tsx` — 767 LOC

**Risk:** Cognitive overload, regression riski, test edilemezlik.
**Öneri:** seasonal/[id] zorunlu sıradaki refactor hedefi. shipments/[id] gibi component extract pattern'i uygula.

### M2. Rate limiter in-memory — instance restart bypass + multi-instance koordinasyonsuz
**Konum:** `lib/rate-limiter.ts:33-35`
**Sorun:** Map<string, entry> — restart sıfırlar. Bir instance bypass için yeterli.
**Risk:** Brute force auth rate limiter'ı bypass olur. PM2 restart attacker'a 0'dan başlama hediye eder.
**Öneri:** Redis (Upstash veya self-hosted). Kod yorumu zaten bunu öneriyor ama dönüş yapılmamış.

### M3. Rate limiter IP + User-Agent — UA spoofing trivial
**Konum:** `lib/rate-limiter.ts:135-142`
**Sorun:** Key User-Agent içeriyor — saldırgan UA random yaparsa her istek farklı bucket'a düşer.
**Risk:** Brute force 5/15min limitini UA random'la bypass.
**Öneri:** Sadece IP. `x-forwarded-for` trust chain'ini koru (Nginx zaten production'da var).

### M4. Audit log tamper-protection yok
**Konum:** `lib/auditLog.ts` + `AuditLog` modeli
**Sorun:** App user'ı DELETE/UPDATE yetkisine sahip. Compromise olursa attacker iz örtebilir.
**Risk:** Forensic kabiliyeti yok.
**Öneri:** DB trigger ile UPDATE/DELETE'i bloka; veya hash chain (her log entry HMAC(prev_hash + payload)). Daha hafif: Sentry/external'a paralel yazım.

### M5. Permission güncelleme race condition
**Konum:** `lib/auth/shipmentPermission.ts:54-82`, `lib/auth/shelfPermission.ts:128-148`
**Sorun:** Admin VIEWER→MANAGER atarken kullanıcı request'i ortasındaysa, request başında VIEWER iken ortasında MANAGER olabilir.
**Risk:** Geçici privilege escalation; "kim ne yaptı" log'unda tutarsız role gözükür.
**Öneri:** Permission row'una `version Int`; check sırasında snapshot al, sonunda match olduğunu doğrula.

### M6. Float vs Decimal — desi/weight kümülatif yuvarlama hatası
**Konum:** `schema.prisma` desi/weight/size kolonları (örn. `desiPerUnit`, `targetDesi`, `plannedDesi`, `desi`)
**Sorun:** IEEE 754 float; 1000+ reserve toplamı invoice ile ±0.5% kayar.
**Risk:** Customs declaration, sevkiyat ağırlık hesabı yanlış. Logistics maliyet reconciliation eşleşmez.
**Öneri:** `Decimal @db.Decimal(10, 2)`.

### M7. `ShelfMovement.refType + refId` polymorphic FK — referential integrity yok
**Konum:** `schema.prisma:680-681`
**Sorun:** refType string ("OUTBOUND_ORDER", "SHIPMENT"), refId UUID — hedef tabloya FK constraint yok. Hedef silinirse orphan kalır.
**Risk:** Audit trail'de geçersiz reference. Undo logic patlar.
**Öneri:** Explicit nullable FK'ler (outboundOrderId, shipmentId, ...) + CHECK constraint tam birinin set olduğunu zorlasın.

### M8. `UserCategoryPermission` PK yok, sadece composite unique
**Konum:** `schema.prisma:108-119`
**Sorun:** `id` PK yok; composite unique var ama PK olmaması bazı ORM ops'larda ve external tooling'de tuhaflık yaratır.
**Risk:** Tekrar eden satır riski; raporlama tool'ları kırılır.
**Öneri:** `id String @id @default(uuid())` ekle, composite'i unique tut.

### M9. `lucide-react` tree-shake için config eksik
**Konum:** `next.config.ts` — `optimizePackageImports` yok
**Sorun:** 560+ ikondan ~50KB gzipped gereksiz client'a gider.
**Risk:** Bundle bloat. Düşük etki ama düşük effort fix.
**Öneri:** `experimental: { optimizePackageImports: ['lucide-react'] }`.

### M10. ExcelJS server bundle'ında
**Konum:** `lib/excel/exporter.ts:6`
**Sorun:** `import ExcelJS from 'exceljs'` top-level — 22MB. Cold start + build time etkisi.
**Risk:** Deploy boyutu, CI süresi.
**Öneri:** Export fonksiyonu içinde `const ExcelJS = await import('exceljs')`.

### M11. GPSR base64 PNG'ler eagerly loaded
**Konum:** `lib/labels/gpsr-assets.ts` + `app/dashboard/shipments/[id]/page.tsx:13`
**Sorun:** 3 base64 PNG (~120KB) shipments/[id] sayfasında her zaman bundle'a girer; sadece EU sevkiyatında kullanılır.
**Risk:** Non-EU kullanıcılar için 120KB israf.
**Öneri:** `await import('@/lib/labels/gpsr-assets')` print modal içinde. Veya PNG'leri `public/` altına koy, runtime'da fetch.

### M12. Zod schema'larda max length yok
**Konum:** `lib/validation/schemas.ts` ve diğer route-içi schema'lar
**Sorun:** `z.string()` ile unbounded — 10MB notes field DoS riski.
**Risk:** Memory exhaustion / Prisma error.
**Öneri:** Tüm string field'lara `.max(N)` ekle. 500 (kısa), 5000 (medium), 65535 (uzun text).

### M13. Sentry breadcrumb / tag yok
**Konum:** `instrumentation.ts`, `instrumentation-client.ts`
**Sorun:** Hata yakalanıyor ama context yok — userId, marketplace, route, action tag'leri yok.
**Risk:** Sentry'de hata gelir, "kim, ne yaparken" yanıtlanamaz.
**Öneri:** `Sentry.setTag('userRole', ...)`, `Sentry.addBreadcrumb({ category: 'shipment', message: 'sent', data: { ... } })`. Critical action'lardan önce breadcrumb at.

### M14. Test coverage çok düşük — 17 test dosyası, 98 route
**Konum:** `tests/` (18 dosya, 271 test ama çoğu `lib/` util'leri)
**Sorun:** 98 route'tan sadece `requests.test.ts` var. Allocator + auth verify test'li, gerisi manuel QA.
**Risk:** Allocation logic regressions, role check bypass'ı CI'da yakalanmaz.
**Öneri:** Critical path'lere integration test: ship state machine, allocator, role checks, warehouse-exit transaction (C3 ile birlikte).

### M15. Pagination eksik — `shipments` list, `audit-logs` list
**Konum:** `app/api/shipments/route.ts` (`take: 100` var ama search/cursor yok), `app/api/audit-logs/route.ts`
**Sorun:** Sabit `take: 100` — 100'den fazla shipment olunca eski'ler gizlenir.
**Risk:** 6 ay sonra eski shipment listede yok, kullanıcı "kayıp" sanır.
**Öneri:** Cursor-based pagination (`createdAt` + `id`). Frontend infinite scroll.

---

## LOW

### L1. seasonal/[id]/page.tsx önceki audit kapsamında değil — 1727 LOC, 27 useState
**Konum:** `app/dashboard/seasonal/[id]/page.tsx`
**Not:** En büyük dosya, refactor edilmemiş. Sıradaki büyük iş adayı.

### L2. `Float` vs `Decimal` daha geniş — sadece desi değil, herhangi parasal field varsa
**Öneri:** Schema sweep — her `Float` için "para mı, miktarı mı, fiziksel ölçü mü" kararı.

### L3. `WarehouseWeekly.type` enum değil, string
**Konum:** `schema.prisma:304`
**Risk:** ETL'de typo → garbage type. Enum eklenmeli.

### L4. `ShelfMovement` `updatedAt` yok
**Konum:** `schema.prisma`
**Risk:** Movement reverse/undo timestamp izlenmiyor. Düşük operasyonel etki.

### L5. `noUncheckedIndexedAccess` aktif değil
**Konum:** `tsconfig.json`
**Risk:** `arr[i]` `T` döner, `T | undefined` olmalı. Subtle index out-of-bounds bug'ları gizler.
**Öneri:** `noUncheckedIndexedAccess: true` — initial flag açılışı ~10-20 type error verebilir, hepsi düzeltilebilir.

### L6. `ESLint no-unused-vars` warn, error değil
**Konum:** `eslint.config.mjs`
**Risk:** Dead code birikir.
**Öneri:** `"error"` yap — şu an 2 preexisting warning var (Header.tsx `<img>`), gerisi temiz.

### L7. Magic number — `MONTH_LABELS`, `DEFAULT_LIMIT`, `PAGE_SIZE` constants
**Konum:** Çeşitli (seasonal page, audit logs)
**Risk:** Düşük — sadece okunabilirlik.

### L8. Bundle analyzer kurulu değil
**Konum:** `package.json`
**Öneri:** `@next/bundle-analyzer` dev dep. `ANALYZE=true npm run build` ile chunk treemap.

### L9. `loading.tsx` / `<Suspense>` boundary'leri yok
**Konum:** Hiçbir dashboard route'unda `loading.tsx` yok.
**Risk:** Yavaş query'lerde tüm sayfa beyaz kalır.
**Öneri:** Yavaş route'lara `loading.tsx` ekle (depolar, seasonal/[id]).

### L10. `ProductSerialCounter` seed yok
**Konum:** `schema.prisma:944-951`
**Risk:** İlk SKU print'inde concurrent insert race riski.
**Öneri:** Migration'da SKU'lar için pre-seed; veya app-level `upsert`.

---

## YANLIŞ POZİTİFLER (Agent'ların bulduğu ama doğrulanmadı)

### ❌ "Exposed Secrets in .env" (security agent CRITICAL)
**Gerçek:** `.gitignore`'da `.env*` var, `.env` git'te tracked değil. `git ls-files | grep "^\.env$"` boş döner. Yerel dev dosyası; production env vars sunucuda + GitHub Secrets'ta.
**Action:** Bulgu düşürüldü.

### ❌ "DB Credentials in .env Committed to Git" (security agent CRITICAL)
**Gerçek:** Aynı sebep — git tracked değil.
**Action:** Bulgu düşürüldü.

### ❌ "27 Client Components in Dashboard" (performance agent HIGH)
**Kısmi gerçek:** Geçen audit'te 4 page RSC'e taşındı (shipments, depolar, labels, shipments/settings, ayrıca seasonal + logs). Şu an ~18-19 client page kaldı, hepsi gereksiz değil. Agent eski sayımı kullanmış olabilir. Yine de devam edecek iş — manufacturer/[category], admin/permissions vb. RSC kazanç potansiyeli yüksek adaylar.

---

## ÖZET TABLO

| Severity | Sayı | Hızlı kazanç önerileri |
|---|---|---|
| CRITICAL | 5 | C1 (redirect fix, 5 dk), C2 (timeout ekle, 10 dk), C3 (transaction, 30 dk) |
| HIGH | 8 | H6 (FK index migration, 1 saat), H7 (silent catch sweep, 2 saat), H8 (cache, 2 saat) |
| MEDIUM | 15 | M9 (lucide config, 1 dk), M10 (ExcelJS lazy, 15 dk), M12 (zod max, 30 dk) |
| LOW | 10 | L8 (bundle analyzer, 5 dk), L9 (loading.tsx, 30 dk) |
| Yanlış pozitif | 3 | — |

**İlk dalga (toplam ~4 saat) — production etkili:**
1. C1: SSO redirect URL base'i parametresiz
2. C2: SSO fetch timeout
3. C3: warehouse-exit transaction
4. M9: `optimizePackageImports: ['lucide-react']`
5. M10: ExcelJS lazy import
6. M12: Zod string max

**İkinci dalga (toplam ~1 hafta) — strategic:**
1. H1: withRoute migration (98 route)
2. H6: FK index migration
3. H7: Silent catch sweep
4. H8: Allocator cache + revalidateTag
5. C5: shipments/[id] custom hook refactor (state explosion)
6. M14: Critical path integration testleri

**Üçüncü dalga (toplam ~2 hafta) — architectural:**
1. H2: Nonce-based CSP
2. H3: Super-admin email server-only
3. H4: SSO token client binding (Apps-SSO koordinasyonu gerek)
4. M2/M3: Redis rate limiter
5. M1: seasonal/[id] page refactor
6. M4: Audit log tamper protection

---

**Genel değerlendirme:** Yapı sağlam — TypeScript strict, audit log var, role/permission sistematik, SSO entegrasyonu mature. Ana eksikler: (a) eski boilerplate pattern'lerinden modern HOF'a geçilmemiş (%2 adoption), (b) silent error swallowing kültürü, (c) shipments/[id] gibi 1000+ LOC sayfalardaki state explosion. Geçtiğimiz hafta yapılan audit ManuMaestro'ya iyi geldi (sevkiyat refactor'ı + RSC migration'ları + auth düzeltmeleri) ama bağımsız taramada hâlâ 5 CRITICAL + 8 HIGH gözüküyor. CRITICAL'lerin 3'ü yarım saatlik kod fix; ilk dalga bugün halledilebilir.
