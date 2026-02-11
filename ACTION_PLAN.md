# ManuMaestro - Aksiyon Planı
**Başlangıç**: 11 Şubat 2026

---

## 🎯 Sprint 1: Güvenlik ve Temizlik (1 Hafta)

### Task 1.1: Production Logging Temizliği ⚡ URGENT
**Süre**: 2-3 saat
**Assignee**: Developer

**Checklist**:
- [ ] `lib/logger.ts` utility oluştur
- [ ] `middleware.ts` - 9 console.log'u değiştir
- [ ] `app/api/requests/monthly/route.ts` - 5 console.log'u değiştir
- [ ] Diğer API route'larda console.log'ları temizle
- [ ] Environment-based logging konfigüre et
- [ ] Test: Development'te log, production'da silent olduğunu doğrula

**Kabul Kriterleri**:
- Production build'de console output minimal
- Development'te debug bilgisi mevcut
- Sensitive data log'lanmıyor

---

### Task 1.2: Environment Variables Düzeltmesi ⚡ URGENT
**Süre**: 30 dakika
**Assignee**: Developer

**Checklist**:
- [ ] `.env.example` dosyasına `SSO_URL` ve `SSO_APP_CODE` ekle
- [ ] `lib/auth/sso.ts` - Hard-coded URL'leri environment variable'a çevir
- [ ] `middleware.ts` - Hard-coded URL'leri environment variable'a çevir
- [ ] Production `.env` dosyasını güncelle
- [ ] Test: Local ve production environment'lerde çalıştığını doğrula

**Kabul Kriterleri**:
- Hard-coded URL yok
- Farklı environment'lerde çalışıyor

---

### Task 1.3: API Input Validation 🔒 SECURITY
**Süre**: 4 saat
**Assignee**: Developer

**Checklist**:
- [ ] `npm install zod` (validation library)
- [ ] `lib/validation/schemas.ts` oluştur
- [ ] Bulk request validation schema yaz
- [ ] Manufacturer update validation schema yaz
- [ ] Marketplace create validation schema yaz
- [ ] Her API route'da validation ekle
- [ ] Error messages user-friendly yap
- [ ] Test: Invalid input'ların reject edildiğini doğrula

**Validation Schemas**:
```typescript
// lib/validation/schemas.ts

import { z } from 'zod';

export const ProductionRequestSchema = z.object({
  iwasku: z.string().min(1).max(50),
  quantity: z.number().int().positive().max(999999),
  productionMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format'),
  marketplaceId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export const BulkRequestSchema = z.object({
  requests: z.array(ProductionRequestSchema).min(1).max(1000),
});

export const ManufacturerUpdateSchema = z.object({
  producedQuantity: z.number().int().nonnegative().max(999999).optional(),
  manufacturerNotes: z.string().max(500).optional(),
  status: z.enum(['REQUESTED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED']).optional(),
});
```

**Kabul Kriterleri**:
- Tüm API endpoint'lerde input validation var
- Invalid input'lar 400 status code ile reject ediliyor
- User-friendly error messages

**Affected Files**:
- `app/api/requests/bulk/route.ts`
- `app/api/manufacturer/requests/[id]/route.ts`
- `app/api/marketplaces/route.ts`
- `app/api/requests/route.ts`

---

## 🎯 Sprint 2: Kod Kalitesi (1 Hafta)

### Task 2.1: Error Handling Standardizasyonu
**Süre**: 4-5 saat
**Assignee**: Developer

**Checklist**:
- [ ] `lib/api/errors.ts` oluştur (ApiError class)
- [ ] `lib/api/response.ts` oluştur (successResponse, errorResponse)
- [ ] Tüm API route'ları yeni pattern'e çevir
- [ ] Consistent error codes ekle
- [ ] Error logging ekle (Sentry entegrasyonu isteğe bağlı)
- [ ] Test: Error response'ların tutarlı olduğunu doğrula

**Implementation**:
```typescript
// lib/api/errors.ts
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: any) {
    super(400, message, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

// lib/api/response.ts
import { NextResponse } from 'next/server';

export function successResponse<T>(data: T, meta?: any) {
  return NextResponse.json({
    success: true,
    data,
    ...(meta && { meta }),
  });
}

export function errorResponse(error: unknown, statusCode = 500) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message,
          code: error.code,
          ...(error.details && { details: error.details }),
        },
      },
      { status: error.statusCode }
    );
  }

  // Generic error
  return NextResponse.json(
    {
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
    },
    { status: statusCode }
  );
}
```

**Kabul Kriterleri**:
- Tüm API endpoint'lerde tutarlı error response
- Error code'ları frontend'de kullanılabilir
- Stack trace production'da expose edilmiyor

---

### Task 2.2: TODO Items Tamamlanması
**Süre**: 3-4 saat
**Assignee**: Developer

**Checklist**:
- [ ] `app/api/audit-logs/route.ts` - SSO'dan user bilgisini al
- [ ] `app/api/requests/route.ts` - SSO'dan user ID'yi al
- [ ] `components/tables/ManufacturerTable.tsx` - API'den veri çek
- [ ] `app/dashboard/manufacturer/page.tsx` - Stats API'yi ekle
- [ ] `app/dashboard/manufacturer/page.tsx` - Categories API'yi ekle
- [ ] `app/dashboard/manufacturer/page.tsx` - Excel export özelliği ekle
- [ ] Tüm TODO comment'lerini kaldır
- [ ] Test: Yeni özelliklerin çalıştığını doğrula

**Kabul Kriterleri**:
- Code'da TODO/FIXME comment'i kalmadı
- Tüm özellikler implement edildi
- User session'dan bilgi düzgün alınıyor

---

### Task 2.3: Database Migration Dokümantasyonu
**Süre**: 1 saat
**Assignee**: Developer/DevOps

**Checklist**:
- [ ] `docs/DATABASE.md` oluştur
- [ ] Migration stratejisi yaz
- [ ] Production migration prosedürü dokümante et
- [ ] Rollback stratejisi yaz
- [ ] Developer guide ekle

**Dokümantasyon İçeriği**:
```markdown
# Database Management

## Development Workflow
1. Schema değişikliği yap: `prisma/schema.prisma`
2. Migration oluştur: `npm run db:migrate`
3. Migration adı açıklayıcı olmalı: `add_user_permissions`

## Production Deployment
1. Backup al: `pg_dump manumaestro_db > backup.sql`
2. Migration deploy: `npx prisma migrate deploy`
3. Smoke test yap

## Rollback
1. Önceki backup'ı restore et
2. Migration history güncelle
```

**Kabul Kriterleri**:
- Dokümantasyon açık ve anlaşılır
- Tüm team migration prosedürünü biliyor

---

## 🎯 Sprint 3: Güvenlik İyileştirmeleri (1 Hafta)

### Task 3.1: Rate Limiting Implementation
**Süre**: 3-4 saat
**Assignee**: Developer

**Checklist**:
- [ ] `lib/middleware/rateLimit.ts` oluştur
- [ ] IP-based rate limiting implement et
- [ ] Endpoint-specific limits tanımla
- [ ] Rate limit headers ekle
- [ ] Redis entegrasyonu (opsiyonel, uzun vadede)
- [ ] Test: Rate limiting'in çalıştığını doğrula

**Rate Limits**:
- Bulk upload: 10 request/minute
- Normal operations: 100 request/minute
- Read operations: 200 request/minute

**Kabul Kriterleri**:
- API'ler rate-limited
- 429 Too Many Requests response dönüyor
- Headers'da limit bilgisi var

---

### Task 3.2: Excel Export İyileştirmesi
**Süre**: 2-3 saat
**Assignee**: Developer

**Checklist**:
- [ ] `exceljs` library ekle (xlsx yerine)
- [ ] Memory-efficient export implement et
- [ ] Large dataset desteği ekle (pagination)
- [ ] Progress indicator ekle
- [ ] Export için manufacturer stats ekle
- [ ] Test: 10,000+ kayıtla test et

**Kabul Kriterleri**:
- Large dataset'ler export edilebiliyor
- Memory leak yok
- UI'da progress indicator var

---

### Task 3.3: Frontend Error Handling
**Süre**: 2-3 saat
**Assignee**: Frontend Developer

**Checklist**:
- [ ] Error boundary component ekle
- [ ] Toast notification sistemi ekle
- [ ] Skeleton loading states ekle
- [ ] Network error handling iyileştir
- [ ] Retry mekanizması ekle
- [ ] Test: Error scenarios'ı test et

**Kabul Kriterleri**:
- App crash etmiyor
- User-friendly error messages
- Loading states düzgün

---

## 🎯 Sprint 4: Testing & Monitoring (2 Hafta)

### Task 4.1: Testing Infrastructure
**Süre**: 8-10 saat
**Assignee**: Developer

**Checklist**:
- [ ] Vitest + React Testing Library ekle
- [ ] Test setup oluştur
- [ ] API route tests yaz (en az 50% coverage)
- [ ] Component tests yaz (kritik componentler)
- [ ] Integration tests yaz
- [ ] CI/CD pipeline'a test ekle
- [ ] Coverage report oluştur

**Priority Tests**:
1. API validation tests
2. Authentication tests
3. Data aggregation tests (monthly API)
4. Proportional distribution tests

**Kabul Kriterleri**:
- Test coverage > 60%
- CI'da otomatik test
- Critical paths test edilmiş

---

### Task 4.2: Performance Monitoring
**Süre**: 2-3 saat
**Assignee**: DevOps/Developer

**Checklist**:
- [ ] Sentry kurulumu
- [ ] Error tracking aktif
- [ ] Performance monitoring aktif
- [ ] Custom metrics ekle
- [ ] Alert rules tanımla
- [ ] Dashboard oluştur

**Kabul Kriterleri**:
- Errors otomatik track ediliyor
- Performance metrics görünüyor
- Alert'ler çalışıyor

---

### Task 4.3: API Documentation
**Süre**: 4-5 saat
**Assignee**: Developer

**Checklist**:
- [ ] Swagger/OpenAPI spec oluştur
- [ ] API endpoint'leri dokümante et
- [ ] Request/Response examples ekle
- [ ] Error codes dokümante et
- [ ] Postman collection oluştur
- [ ] README'ye link ekle

**Kabul Kriterleri**:
- Tüm endpoint'ler dokümante
- Examples mevcut
- Yeni developer onboarding kolay

---

## 📊 İlerleme Takibi

### Sprint 1 Checklist
- [ ] Task 1.1: Logging temizliği
- [ ] Task 1.2: Environment variables
- [ ] Task 1.3: Input validation

### Sprint 2 Checklist
- [ ] Task 2.1: Error handling
- [ ] Task 2.2: TODO items
- [ ] Task 2.3: DB documentation

### Sprint 3 Checklist
- [ ] Task 3.1: Rate limiting
- [ ] Task 3.2: Excel export
- [ ] Task 3.3: Frontend errors

### Sprint 4 Checklist
- [ ] Task 4.1: Testing
- [ ] Task 4.2: Monitoring
- [ ] Task 4.3: Documentation

---

## 🎯 Başarı Metrikleri

### Week 1 (Sprint 1)
- [ ] Zero console.log in production
- [ ] All hard-coded values moved to env
- [ ] Input validation coverage: 100%

### Week 2 (Sprint 2)
- [ ] All TODO items completed
- [ ] Error handling standardized
- [ ] DB migration docs ready

### Week 3 (Sprint 3)
- [ ] Rate limiting active
- [ ] Excel export works for 10k+ records
- [ ] Error boundaries implemented

### Week 4-5 (Sprint 4)
- [ ] Test coverage > 60%
- [ ] Sentry monitoring active
- [ ] API documentation complete

---

## 💡 Notlar

### İsteğe Bağlı İyileştirmeler (Backlog)
- [ ] Redis için rate limiting
- [ ] GraphQL API (REST alternatifi)
- [ ] Mobile app support
- [ ] Real-time updates (WebSocket)
- [ ] Advanced analytics dashboard
- [ ] Multi-language support
- [ ] Dark mode

### Bilinen Kısıtlamalar
- SSO'ya dependency var (IWA Apps SSO)
- Product database external (pricelab-db)
- Single server deployment (scaling için değişiklik gerekebilir)

### Risk Yönetimi
- **Risk**: SSO down olursa app çalışmaz
  - **Mitigation**: Fallback auth mechanism (emergency access)

- **Risk**: Large dataset'lerde performance issue
  - **Mitigation**: Pagination + caching + indexing

- **Risk**: Production deployment sırasında downtime
  - **Mitigation**: Blue-green deployment stratejisi

---

**Son Güncelleme**: 11 Şubat 2026
**Versiyon**: 1.0
**Owner**: Development Team
