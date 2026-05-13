# ManuMaestro — Pre-Deploy Smoke Checklist

Bu app-spesifik checklist. Generic / tum-app'ler-icin-gecerli kontrolleri
**[apps/SMOKE_TEMPLATE.md](../SMOKE_TEMPLATE.md)** dosyasinda. Once
template'i kos, sonra asagidakileri uygula.

CI Playwright spec: `apps/e2e/tests/manumaestro/*.spec.ts`. Manuel kontrol
spec'lerin kapsamadigi rol/gorsel regresyonlar icin.

## Test kullanicilari

| Email | DB role | Shelf permissions | Shipment permissions |
|-------|---------|-------------------|----------------------|
| ersoy@iwaconcept.com.tr | ADMIN | (admin = hepsi) | (admin = hepsi) |
| ahmtersoy23@gmail.com | OPERATOR | `*` MANAGER + ANKARA VIEWER | (atanmamis) |
| iwaconcept1@gmail.com (Cihan) | OPERATOR | ANKARA PACKER + NJ/SHOWROOM VIEWER | (atanmamis) |

> Yeni test kullanici eklendiginde bu tabloyu guncelle.

## ADMIN (ersoy@) akislari

- [ ] `/dashboard` ana sayfa yukleniyor
- [ ] `/dashboard/depolar` — 3 depo (Somerset/Ankara/Fairfield) goruluyor
- [ ] `/dashboard/depolar/somerset` — depo detay acilir, raf/stok kirilimi
- [ ] `/dashboard/depolar/somerset/sayim` — cycle count baslat
- [ ] `/dashboard/depolar/somerset/siparis` — sipariş çıkış lobi acilir
- [ ] `/dashboard/depolar/somerset/siparis/AMZN_US/<order-id>` — kalem ekle paneli + kamera ikonu
- [ ] `/dashboard/shipments?tab=US` — sevkiyatlar listeleniyor, "Yeni Sevkiyat" butonu var
- [ ] Bir Deniz shipment'i ac → "Ürünler" tab'da chevron / "Koliler" tab'da kolileme UI'i
- [ ] Bir Kara/Hava shipment'i ac → packed checkbox + send butonu
- [ ] `/dashboard/seasonal` — aktif sezon havuzuna yonlendiriyor
- [ ] `/dashboard/requests` — talep listesi + "Yeni Talep" butonu (super-admin)
- [ ] `/dashboard/logs` — audit logs

## Non-admin (Ahmet — MANAGER `*`)

- [ ] `/dashboard/depolar` — 3 depo goruyor (MANAGER `*` = hepsi)
- [ ] Bir depoda "Raf Olustur" / "Sayım" / "Transfer" butonlari aktif
- [ ] `/dashboard/shipments?tab=US` — yukleniyor, "Yeni Sevkiyat" butonu YOK (createShipment yetkisi yok)

## Non-admin (Cihan — ANKARA PACKER)

- [ ] `/dashboard/depolar` — 3 depo goruyor (ANKARA + NJ + SHOWROOM, view tum)
- [ ] `/dashboard/depolar/ankara` — sipariş çıkış (createOutbound, shipOutbound) aktif
- [ ] `/dashboard/depolar/somerset` — read-only (yetkisiz aksiyonlar disabled/hidden)
- [ ] Yetkisiz aksiyon API'ye direkt POST denemesi → 403 (DevTools fetch denemesi)

## ManuMaestro kritik API kontratlari

- [ ] `GET /api/shipments/[id]` → `data.meta.permissions.manageBoxes` field'i (top-level DEGIL — `data.meta` altinda)
- [ ] `GET /api/shipments` → `data[]` array (meta.permissions.canCreate top-level RSC tarafindan kullaniliyor, client direk okumaz)
- [ ] `GET /api/auth/me` → `permissions.canViewStock` TOP-LEVEL (custom shape — `data` altinda DEGIL)
- [ ] `GET /api/health` → 200 success
- [ ] `GET /api/sentry-verify` → 200 + JSON `{ success: true }`

## Build / Prerender kontrolleri

- [ ] Server Component pages (RSC) `prisma.X.findFirst/findMany` calistiyorsa
      `export const dynamic = 'force-dynamic'` veya `searchParams`/`headers()`
      cagrisi var (yoksa `next build` static prerender'da ECONNREFUSED firlatir)
- [ ] Yeni RSC sayfasi eklendiyse `lib/auth/rscUser.ts` helper'ini kullaniyor
      (x-user-id header'i SSO ID, lokal user.id DEGIL)
- [ ] `prisma generate` deploy.yml'da var (zaten var, dokunma)

## Veri bagimliliklari

- [ ] pricelab_db schema degisikligi yok (varsa 4 app'i etkiler — generic'e bak)
- [ ] Yeni migration sonrasi `pricelab` user'a GRANT atildi mi:
      `sudo -u postgres psql -d manumaestro_db -c "GRANT ALL ON TABLE <x> TO pricelab"`
      (Migration playbook hatirla)
- [ ] Prisma Decimal kolon eklendiyse: API response'da `Number(x).toFixed()` kullaniliyor mu (string olarak iner)

## ManuMaestro-spesifik bilinen yanlis pozitifler

- `Content Security Policy` `Report-Only` console mesajlari — Adim 1 deploy
  sonrasi gozlem fazi (2026-05-13 → 2026-05-20). Adim 2 (enforce) tamamlanana
  kadar normal.
- `components/ui/Header.tsx` 124, 147 satirlarinda `<img>` ESLint warning —
  bilincli, Image migration baska task.
- `Failed to create audit log: ... 'create'` tests/lib/auth-verify.test.ts'de
  stderr'da gozukur ama 271 test gecer — audit log mock test bagimliligi degil.

## Versiyon

- Son guncelleme: 2026-05-13 (commit `a376ce8` sonrasi)
- Yeni regresyonda guncelle
