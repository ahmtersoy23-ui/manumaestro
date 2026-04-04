# ManuMaestro

Uretim talep yonetimi + sezonsal stok + sevkiyat. Next.js 16 + Prisma 7.

## Komutlar
```bash
npm run dev      # next dev (port 3000)
npm test         # vitest (13 test)
npm run build    # next build (prisma generate dahil)
```

## Kurallar
- `prisma generate` deploy'dan once ZORUNLU (deploy.yml'da var)
- Prisma schema degistiginde: `npx prisma migrate dev --name aciklama`
- Waterfall completion: strict sirali, karsilanamayan oncelik sonrayi bloklar
- Min batch = sabit 15, yuvarlama YOK
- Lead time = agirlik kaydirma (sert deadline degil, SHIFT_STRENGTH=0.4)
- Her kategorinin uretim bandi ayri → allocator'da bagimsiz dagitim
- pricelab_db'den sadece OKUR (productPool), YAZMAZ

## Onemli Dosyalar
- `lib/seasonal/allocator.ts` — sezonsal dagitim motoru
- `lib/waterfallComplete.ts` — oncelik bazli tamamlama
- `lib/db/prisma.ts` — DB baglantilari (prisma + productPool)
- `prisma/schema.prisma` — tum modeller
