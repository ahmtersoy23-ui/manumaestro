import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// verifyAuth ve rateLimiters'i mockla — HOF logic'ini izole test ediyoruz
vi.mock('@/lib/auth/verify', () => ({
  verifyAuth: vi.fn(),
}));

vi.mock('@/lib/middleware/rateLimit', () => {
  const passingLimiter = {
    check: vi.fn(async () => ({ success: true, limit: 100, remaining: 99, resetTime: Date.now() + 60_000 })),
  };
  const failingLimiter = {
    check: vi.fn(async () => ({ success: false, limit: 100, remaining: 0, resetTime: Date.now() + 60_000, retryAfter: 60 })),
  };
  return {
    rateLimiters: {
      read: passingLimiter,
      write: passingLimiter,
      bulk: passingLimiter,
      __failing: failingLimiter,
    },
    rateLimitExceededResponse: vi.fn((result) =>
      NextResponse.json({ success: false, error: 'rate limited', details: result }, { status: 429 })
    ),
  };
});

import { withRoute } from '@/lib/api/withRoute';
import { verifyAuth } from '@/lib/auth/verify';
import { rateLimiters } from '@/lib/middleware/rateLimit';

const mockedVerifyAuth = vi.mocked(verifyAuth);
const mockUser = { id: 'u1', email: 'a@b.com', name: 'A', role: 'admin' as const };

function mockRequest(url = 'http://localhost/api/test'): NextRequest {
  return new NextRequest(url);
}

describe('withRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerifyAuth.mockResolvedValue({ success: true, user: mockUser });
  });

  describe('auth', () => {
    it('verifyAuth basarisizsa 401 doner', async () => {
      mockedVerifyAuth.mockResolvedValueOnce({ success: false, error: 'Token yok' });
      const handler = withRoute({}, async () => NextResponse.json({ ok: true }));
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Token yok');
    });

    it('skipAuth: true ile auth check yapilmaz', async () => {
      // mockResolvedValueOnce queue'ya birikip sonraki teste taşmasın diye
      // burada set ETME — beforeEach baseline'ı zaten var, sadece çağrılmadığını doğrula
      const handler = withRoute({ skipAuth: true }, async ({ user }) => {
        expect(user).toBeUndefined();
        return NextResponse.json({ ok: true });
      });
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(200);
      expect(mockedVerifyAuth).not.toHaveBeenCalled();
    });

    it('handler verifiedUser alir', async () => {
      let capturedUser: typeof mockUser | undefined;
      const handler = withRoute({}, async ({ user }) => {
        capturedUser = user;
        return NextResponse.json({ email: user!.email });
      });
      await handler(mockRequest(), undefined);
      expect(capturedUser).toEqual(mockUser);
      expect(capturedUser?.email).toBe('a@b.com');
    });
  });

  describe('roles', () => {
    it('roles match olmazsa 403', async () => {
      mockedVerifyAuth.mockResolvedValueOnce({
        success: true,
        user: { ...mockUser, role: 'viewer' },
      });
      const handler = withRoute({ roles: ['admin'] }, async () => NextResponse.json({ ok: true }));
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(403);
    });

    it('roles match ederse handler calisir', async () => {
      const handler = withRoute({ roles: ['admin', 'editor'] }, async () =>
        NextResponse.json({ ok: true })
      );
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(200);
    });

    it('bos roles array tum auth kullanicilara izin verir', async () => {
      mockedVerifyAuth.mockResolvedValueOnce({
        success: true,
        user: { ...mockUser, role: 'viewer' },
      });
      const handler = withRoute({ roles: [] }, async () => NextResponse.json({ ok: true }));
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(200);
    });
  });

  describe('rate limit', () => {
    it('rate limit asilirsa 429', async () => {
      // Failing limiter'i 'read' yerine bilerek koy
      const originalRead = rateLimiters.read;
      // @ts-expect-error — test helper
      rateLimiters.read = rateLimiters.__failing;
      const handler = withRoute({ rateLimit: 'read' }, async () => NextResponse.json({ ok: true }));
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(429);
      // restore
      rateLimiters.read = originalRead;
    });

    it('rateLimit: false ile rate limit atlanir', async () => {
      const handler = withRoute({ rateLimit: false }, async () => NextResponse.json({ ok: true }));
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('handler throw ederse errorResponse 500 doner', async () => {
      const handler = withRoute({}, async () => {
        throw new Error('boom');
      });
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('verifyAuth throw ederse de yakalanir', async () => {
      mockedVerifyAuth.mockRejectedValueOnce(new Error('SSO 500'));
      const handler = withRoute({}, async () => NextResponse.json({ ok: true }));
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(500);
    });
  });

  describe('params', () => {
    it('routeCtx params Promise olarak gelir, handler resolved alir', async () => {
      const handler = withRoute<{ id: string }>({}, async ({ params }) => {
        expect(params.id).toBe('123');
        return NextResponse.json({ id: params.id });
      });
      const res = await handler(mockRequest(), { params: Promise.resolve({ id: '123' }) });
      const body = await res.json();
      expect(body.id).toBe('123');
    });

    it('routeCtx undefined ise params bos obje', async () => {
      const handler = withRoute({}, async ({ params }) => {
        expect(params).toEqual({});
        return NextResponse.json({ ok: true });
      });
      const res = await handler(mockRequest(), undefined);
      expect(res.status).toBe(200);
    });
  });
});
