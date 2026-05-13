/**
 * POST /api/internal/labels/cleanup
 *
 * Etiket retention worker. Yetkilendirme:
 *   - Authorization: Bearer ${INTERNAL_CLEANUP_TOKEN}  (cron için)
 *   - VEYA SSO admin kullanıcı (manuel UI tetikleme için)
 *
 * Davranış:
 *   - Tip bazlı retention (SHIPPING=14g, FNSKU=hiç, OTHER=30g)
 *   - Eşik aşılan + henüz arşivlenmemiş kayıtları arşivler:
 *       * fiziksel dosya silinir
 *       * archivedAt = now()
 *       * fileName ve trackingNumber korunur (referans amaçlı)
 *   - Kuru çalıştırma: ?dryRun=true (silmez, sadece sayım döner)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { deleteLabelFile, getRetentionThreshold } from '@/lib/wms/labelStorage';
import { createLogger } from '@/lib/logger';
import { withRoute } from '@/lib/api/withRoute';

const logger = createLogger('LabelCleanup');

const TYPES_WITH_RETENTION: Array<'SHIPPING' | 'OTHER'> = ['SHIPPING', 'OTHER'];

async function authorize(request: NextRequest): Promise<boolean> {
  const token = process.env.INTERNAL_CLEANUP_TOKEN;
  if (token) {
    const authHeader = request.headers.get('authorization');
    if (authHeader === `Bearer ${token}`) return true;
  }
  // Fallback: SSO admin
  const auth = await verifyAuth(request);
  return auth.success && auth.user?.role === 'admin';
}

// Cron token VEYA SSO admin — çift mod, handler içinde authorize.
export const POST = withRoute(
  { skipAuth: true, rateLimit: 'bulk', fallbackMessage: 'Cleanup başarısız' },
  async ({ request }) => {
    const ok = await authorize(request);
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Yetkisiz' }, { status: 401 });
    }

    const dryRun = new URL(request.url).searchParams.get('dryRun') === 'true';
    const now = new Date();

    const summary: Record<string, { eligible: number; archived: number; failed: number }> = {};
    let totalArchived = 0;

    for (const type of TYPES_WITH_RETENTION) {
      const threshold = getRetentionThreshold(type, now);
      if (!threshold) continue;

      const candidates = await prisma.orderLabel.findMany({
        where: {
          type,
          archivedAt: null,
          uploadedAt: { lt: threshold },
        },
        select: { id: true, storagePath: true, fileSize: true },
      });

      summary[type] = { eligible: candidates.length, archived: 0, failed: 0 };

      if (dryRun) continue;

      for (const c of candidates) {
        try {
          await deleteLabelFile(c.storagePath);
          await prisma.orderLabel.update({
            where: { id: c.id },
            data: { archivedAt: now },
          });
          summary[type].archived++;
          totalArchived++;
        } catch (e) {
          logger.error(`Cleanup ${type}/${c.id}`, e);
          summary[type].failed++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      runAt: now.toISOString(),
      totalArchived,
      summary,
    });
  }
);
