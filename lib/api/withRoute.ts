/**
 * Higher-order function for API route handlers.
 *
 * Boilerplate kaldırılır: rate limit + auth + try/catch + errorResponse
 * tek yerden, deklaratif. Audit'te 4 route'un try/catch'siz olması ve 96
 * route'ta 50-70 satır tekrar eden boilerplate'i ortadan kaldırır.
 *
 * Kullanım:
 *
 *   export const GET = withRoute({ rateLimit: 'read' }, async ({ user, params }) => {
 *     const data = await prisma.foo.findUnique({ where: { id: params.id } });
 *     return successResponse(data);
 *   });
 *
 *   // Auth gerektirmeyen public endpoint:
 *   export const POST = withRoute({ skipAuth: true }, async ({ request }) => {
 *     // ...
 *   });
 *
 *   // Bulk endpoint (daha sıkı rate limit):
 *   export const POST = withRoute({ rateLimit: 'bulk' }, async ({ user }) => {
 *     // ...
 *   });
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, type VerifiedUser } from '@/lib/auth/verify';
import {
  rateLimiters,
  rateLimitExceededResponse,
} from '@/lib/middleware/rateLimit';
import { errorResponse } from './response';

export type RateLimitTier = 'read' | 'write' | 'bulk' | false;

export interface RouteOptions {
  /** false = rate limit kapali (admin internal route'lar icin). Default 'read'. */
  rateLimit?: RateLimitTier;
  /** true = auth atla (public endpoint'ler icin). Default false (auth zorunlu). */
  skipAuth?: boolean;
  /** Auth gectikten sonra rol filtresi. Bos array veya undefined → tum auth kullanicilar OK. */
  roles?: Array<'admin' | 'editor' | 'viewer'>;
  /** errorResponse'a verilecek fallback mesaji (production'da kullaniciya gosterilir). */
  fallbackMessage?: string;
}

export interface RouteContext<P> {
  request: NextRequest;
  /** skipAuth: true ise undefined, aksi halde dogrulanmis kullanici. */
  user: VerifiedUser | undefined;
  /** Route segment params (path/[id]/route.ts → { id }). */
  params: P;
}

/**
 * Route handler'i HOF'la sar. Hata yakalama, rate limit, auth standartlasir.
 */
export function withRoute<P = Record<string, string>>(
  options: RouteOptions,
  handler: (ctx: RouteContext<P>) => Promise<NextResponse>
) {
  return async (
    request: NextRequest,
    routeCtx: { params: Promise<P> } | undefined
  ): Promise<NextResponse> => {
    try {
      // Next.js 15+ dynamic params Promise — bazi route'lar context vermez
      const params = (routeCtx?.params ? await routeCtx.params : ({} as P));

      // Rate limit
      if (options.rateLimit !== false) {
        const tier = options.rateLimit ?? 'read';
        const limiter = rateLimiters[tier];
        const rl = await limiter.check(request, request.nextUrl.pathname);
        if (!rl.success) return rateLimitExceededResponse(rl);
      }

      // Auth
      let user: VerifiedUser | undefined;
      if (!options.skipAuth) {
        const auth = await verifyAuth(request);
        if (!auth.success || !auth.user) {
          return NextResponse.json(
            { success: false, error: auth.error || 'Yetkisiz erişim' },
            { status: 401 }
          );
        }
        user = auth.user;
        if (options.roles && options.roles.length > 0 && !options.roles.includes(user.role)) {
          return NextResponse.json(
            { success: false, error: 'Yetersiz yetki' },
            { status: 403 }
          );
        }
      }

      return await handler({ request, user, params });
    } catch (error) {
      return errorResponse(error, options.fallbackMessage ?? 'Sunucu hatası');
    }
  };
}
