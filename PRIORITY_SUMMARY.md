# 🚨 Öncelikli Aksiyonlar - Hızlı Özet

## ⚡ Bu Hafta Mutlaka Yapılmalı (P0)

### 1. Input Validation Ekle - 🔒 SECURITY CRITICAL
**Süre**: 4 saat
**Neden Kritik**: SQL injection ve invalid data riski var

```bash
npm install zod
```

**Quick Fix**:
```typescript
// app/api/requests/bulk/route.ts
import { z } from 'zod';

const RequestSchema = z.object({
  iwasku: z.string().min(1).max(50),
  quantity: z.number().int().positive().max(999999),
  productionMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

// Route içinde:
const validation = RequestSchema.safeParse(body);
if (!validation.success) {
  return NextResponse.json(
    { error: 'Invalid input', details: validation.error },
    { status: 400 }
  );
}
```

**Etkilenen Dosyalar**:
- `app/api/requests/bulk/route.ts`
- `app/api/manufacturer/requests/[id]/route.ts`
- `app/api/marketplaces/route.ts`

---

### 2. Console.log Temizliği - 📝 PERFORMANCE
**Süre**: 2 saat
**Neden Kritik**: 53 adet log production'da gereksiz overhead

**Quick Fix**:
```typescript
// lib/logger.ts
export const logger = {
  debug: (...args: any[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG]', ...args);
    }
  },
  error: (...args: any[]) => {
    console.error('[ERROR]', ...args);
  },
};

// Usage:
// console.log('test') yerine:
logger.debug('test');
```

**Temizlenecek Dosyalar**:
- `middleware.ts` (9 log)
- `app/api/requests/monthly/route.ts` (5 log)
- Tüm API routes

---

### 3. Environment Variables - ⚙️ CONFIG
**Süre**: 30 dakika
**Neden Kritik**: Hard-coded SSO URL farklı environment'lerde sorun yaratır

```bash
# .env
SSO_URL=https://apps.iwa.web.tr
SSO_APP_CODE=manumaestro
```

```typescript
// lib/auth/sso.ts
- const SSO_URL = 'https://apps.iwa.web.tr';
+ const SSO_URL = process.env.SSO_URL!;
```

---

## 🟡 Önümüzdeki 2 Hafta (P1)

### 4. Rate Limiting
**Süre**: 3 saat
**Impact**: DDoS koruması

```typescript
// lib/rateLimit.ts - Simple implementation
const requests = new Map<string, number[]>();

export function rateLimit(ip: string, limit = 100) {
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const userRequests = requests.get(ip) || [];

  const recentRequests = userRequests.filter(time => now - time < windowMs);

  if (recentRequests.length >= limit) {
    return false;
  }

  recentRequests.push(now);
  requests.set(ip, recentRequests);
  return true;
}
```

---

### 5. Error Handling Standardize Et
**Süre**: 4 saat
**Impact**: Maintainability + debugging

```typescript
// lib/api/response.ts
export function apiResponse(data: any) {
  return NextResponse.json({ success: true, data });
}

export function apiError(message: string, status = 500) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// Usage:
try {
  const data = await fetchData();
  return apiResponse(data);
} catch (error) {
  return apiError('Failed to fetch', 500);
}
```

---

### 6. TODO Items Tamamla
**Süre**: 4 saat
**Impact**: Feature completeness

**Liste**:
1. `app/api/audit-logs/route.ts` - User info from SSO
2. `app/api/requests/route.ts` - User ID from SSO
3. `components/tables/ManufacturerTable.tsx` - API integration
4. `app/dashboard/manufacturer/page.tsx` - Stats API
5. `app/dashboard/manufacturer/page.tsx` - Excel export

---

## 📊 Hızlı Skor Kartı

### Şu Anki Durum
```
Güvenlik:      ⭐⭐⭐⚪⚪ (6/10)
Performans:    ⭐⭐⭐⭐⚪ (8/10)
Kod Kalitesi:  ⭐⭐⭐⭐⚪ (7/10)
Test Coverage: ⚪⚪⚪⚪⚪ (0/10)
Dokümantasyon: ⭐⭐⭐⚪⚪ (5/10)
```

### 1 Ay Sonraki Hedef
```
Güvenlik:      ⭐⭐⭐⭐⭐ (9/10)
Performans:    ⭐⭐⭐⭐⭐ (9/10)
Kod Kalitesi:  ⭐⭐⭐⭐⭐ (9/10)
Test Coverage: ⭐⭐⭐⚪⚪ (6/10)
Dokümantasyon: ⭐⭐⭐⭐⚪ (8/10)
```

---

## 🎯 Quick Win'ler (1 günde halledilebilir)

### Quick Win 1: Logging (2 saat)
```bash
# 1. Create logger
touch lib/logger.ts

# 2. Replace all console.log
# Find: console.log
# Replace: logger.debug
```

### Quick Win 2: Env Variables (30 dk)
```bash
# 1. Update .env
echo "SSO_URL=https://apps.iwa.web.tr" >> .env
echo "SSO_APP_CODE=manumaestro" >> .env

# 2. Update code
# middleware.ts line 30, 36
# lib/auth/sso.ts line 6, 7
```

### Quick Win 3: Basic Validation (1 saat)
```bash
npm install zod

# Add validation to most critical endpoint:
# app/api/requests/bulk/route.ts
```

---

## 📋 Checklist - Bu Hafta

### Pazartesi
- [ ] Zod install et
- [ ] Logger utility yaz
- [ ] Environment variables düzelt

### Salı
- [ ] Input validation ekle (bulk endpoint)
- [ ] Input validation ekle (manufacturer endpoint)
- [ ] Console.log'ları temizle (middleware)

### Çarşamba
- [ ] Console.log'ları temizle (API routes)
- [ ] Error handling refactor başla
- [ ] Response helpers yaz

### Perşembe
- [ ] Error handling tüm API'lerde uygula
- [ ] TODO items başla
- [ ] Test et

### Cuma
- [ ] TODO items bitir
- [ ] Integration test
- [ ] Production deploy

---

## 🚀 Deployment Checklist

### Pre-Deploy
- [ ] All tests passing
- [ ] No console.log in production code
- [ ] Environment variables configured
- [ ] Database backup alındı

### Deploy
- [ ] Git push
- [ ] SSH to server
- [ ] Pull latest
- [ ] npm run build
- [ ] pm2 restart

### Post-Deploy
- [ ] Smoke test (login, create request, view stats)
- [ ] Error logs kontrol
- [ ] Performance metrics kontrol
- [ ] Rollback plan hazır

---

## 💰 ROI Tahmini

### Zaman Yatırımı
- Sprint 1 (Security): 7 saat
- Sprint 2 (Quality): 10 saat
- Sprint 3 (Features): 8 saat
- **Toplam**: ~25 saat (3 iş günü)

### Kazanım
- 🔒 Security: %50 iyileşme
- ⚡ Performance: %20 iyileşme
- 🐛 Bug rate: %40 azalma
- 👥 Developer productivity: %30 artış
- 📝 Onboarding time: %50 azalma

### Break-even Point
- **1 ay**: Security iyileşmeleri riski azaltır
- **2 ay**: Kod kalitesi refactoring time'ı azaltır
- **3 ay**: Test coverage bug rate'i azaltır

---

## 🆘 Acil Durum Protokolü

### Production'da Sorun Varsa

1. **Hemen Rollback**
```bash
ssh root@78.47.117.36 -p 2222
cd /var/www/manumaestro
git log --oneline | head -5  # Son commit'i bul
git reset --hard <previous-commit>
npm run build
pm2 restart manumaestro
```

2. **Logs Kontrol**
```bash
pm2 logs manumaestro --lines 100
```

3. **Database Restore** (eğer gerekirse)
```bash
psql manumaestro_db < backup_2026_02_11.sql
```

---

**Son Güncelleme**: 11 Şubat 2026
**Next Review**: 18 Şubat 2026
**Owner**: Development Team
