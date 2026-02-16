import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SSO Middleware');
const SSO_URL = process.env.SSO_URL || 'https://apps.iwa.web.tr';
const SSO_APP_CODE = process.env.SSO_APP_CODE || 'manumaestro';

export async function middleware(request: NextRequest) {
  logger.debug('Request:', request.nextUrl.pathname);

  // Get token from cookie or URL parameter
  const tokenFromCookie = request.cookies.get('sso_access_token')?.value;
  const tokenFromUrl = request.nextUrl.searchParams.get('token');

  logger.debug('Token from cookie:', tokenFromCookie ? 'exists' : 'none');
  logger.debug('Token from URL:', tokenFromUrl ? 'exists' : 'none');

  // If token in URL, save to cookie and redirect to clean URL
  if (tokenFromUrl) {
    const response = NextResponse.redirect(new URL(request.nextUrl.pathname, request.url));
    response.cookies.set('sso_access_token', tokenFromUrl, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 // 24 hours
    });
    return response;
  }

  const token = tokenFromCookie;

  // No token - redirect to SSO (or return JSON for API routes)
  if (!token) {
    // For API routes (except /api/auth/*), return JSON 401
    if (request.nextUrl.pathname.startsWith('/api/') && !request.nextUrl.pathname.startsWith('/api/auth/')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL(SSO_URL, request.url));
  }

  try {
    logger.debug('Verifying token with SSO backend...');
    // Verify token with SSO
    const response = await fetch('https://apps.iwa.web.tr/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        app_code: SSO_APP_CODE
      })
    });

    logger.debug('SSO response status:', response.status);
    const data = await response.json();
    logger.debug('SSO response:', JSON.stringify(data));

    if (!data.success) {
      logger.debug('Token invalid, redirecting to SSO');
      // Invalid token - clear cookie and redirect to SSO
      const redirectResponse = NextResponse.redirect(new URL(SSO_URL, request.url));
      redirectResponse.cookies.delete('sso_access_token');
      return redirectResponse;
    }

    logger.debug('Token valid, allowing access');

    // Token valid - add user info to headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-email', data.data.user.email);
    requestHeaders.set('x-user-name', data.data.user.name);
    requestHeaders.set('x-user-role', data.data.role);
    requestHeaders.set('x-user-id', data.data.user.id);

    // For API routes, return JSON responses for auth failures
    if (request.nextUrl.pathname.startsWith('/api/')) {
      if (!data.success) {
        return NextResponse.json(
          { error: 'Invalid or expired token' },
          { status: 401 }
        );
      }
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    logger.error('SSO verification error:', error);
    // On error, redirect to SSO (or return JSON for API routes)
    if (request.nextUrl.pathname.startsWith('/api/') && !request.nextUrl.pathname.startsWith('/api/auth/')) {
      return NextResponse.json(
        { error: 'Auth service unavailable' },
        { status: 503 }
      );
    }
    const redirectResponse = NextResponse.redirect(new URL(SSO_URL, request.url));
    redirectResponse.cookies.delete('sso_access_token');
    return redirectResponse;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder (svg, png, jpg, ico files)
     * NOTE: API routes are now included for authentication
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.jpg|.*\\.ico).*)',
  ],
};
