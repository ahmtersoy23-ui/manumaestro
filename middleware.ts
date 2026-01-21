import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Get token from cookie or URL parameter
  const tokenFromCookie = request.cookies.get('sso_access_token')?.value;
  const tokenFromUrl = request.nextUrl.searchParams.get('token');

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

  // No token - redirect to SSO
  if (!token) {
    return NextResponse.redirect(new URL('https://apps.iwa.web.tr', request.url));
  }

  try {
    // Verify token with SSO
    const response = await fetch('https://apps.iwa.web.tr/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        app_code: 'manumaestro'
      })
    });

    const data = await response.json();

    if (!data.success) {
      // Invalid token - clear cookie and redirect to SSO
      const redirectResponse = NextResponse.redirect(new URL('https://apps.iwa.web.tr', request.url));
      redirectResponse.cookies.delete('sso_access_token');
      return redirectResponse;
    }

    // Token valid - add user info to headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-email', data.data.user.email);
    requestHeaders.set('x-user-name', data.data.user.name);
    requestHeaders.set('x-user-role', data.data.role);
    requestHeaders.set('x-user-id', data.data.user.id);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error('SSO verification error:', error);
    // On error, redirect to SSO
    const redirectResponse = NextResponse.redirect(new URL('https://apps.iwa.web.tr', request.url));
    redirectResponse.cookies.delete('sso_access_token');
    return redirectResponse;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.jpg|.*\\.ico).*)',
  ],
};
