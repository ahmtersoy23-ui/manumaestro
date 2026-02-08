import { NextRequest, NextResponse } from 'next/server';

const SSO_VERIFY_URL = 'https://apps.iwa.web.tr/api/auth/verify';
const APP_CODE = 'manumaestro';

/**
 * GET /api/auth/me
 * Returns current user info by verifying SSO token from cookie
 */
export async function GET(request: NextRequest) {
  try {
    // Get token from cookie
    const token = request.cookies.get('sso_access_token')?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'No authentication token' },
        { status: 401 }
      );
    }

    // Verify token with SSO backend
    const response = await fetch(SSO_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app_code: APP_CODE })
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: 'Token verification failed' },
        { status: 401 }
      );
    }

    const data = await response.json();

    if (!data.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: data.data.user.id,
        email: data.data.user.email,
        name: data.data.user.name,
      },
      role: data.data.role || 'viewer',
    });
  } catch (error) {
    console.error('Error in /api/auth/me:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
