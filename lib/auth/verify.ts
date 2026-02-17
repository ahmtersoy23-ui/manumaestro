/**
 * Server-side Authentication Utilities
 * Verify SSO tokens and check user roles in API routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Auth Verify');
const SSO_VERIFY_URL = 'https://apps.iwa.web.tr/api/auth/verify';
const APP_CODE = 'manumaestro';

export interface VerifiedUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
}

export interface AuthResult {
  success: boolean;
  user?: VerifiedUser;
  error?: string;
}

/**
 * Verify SSO token from request cookie
 * Returns user info if valid, error if invalid
 */
export async function verifyAuth(request: NextRequest): Promise<AuthResult> {
  try {
    // Get token from cookie
    const token = request.cookies.get('sso_access_token')?.value;

    if (!token) {
      return {
        success: false,
        error: 'No authentication token',
      };
    }

    // Verify token with SSO backend
    const response = await fetch(SSO_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app_code: APP_CODE }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'Token verification failed',
      };
    }

    const data = await response.json();

    if (!data.success) {
      return {
        success: false,
        error: 'Invalid token',
      };
    }

    return {
      success: true,
      user: {
        id: data.data.user.id,
        email: data.data.user.email,
        name: data.data.user.name,
        role: data.data.role || 'viewer',
      },
    };
  } catch (error) {
    logger.error('Auth verification error:', error);
    return {
      success: false,
      error: 'Internal server error',
    };
  }
}

/**
 * Verify user has required role
 * Returns user if authorized, error response if not
 */
export async function requireRole(
  request: NextRequest,
  requiredRoles: ('admin' | 'editor' | 'viewer')[]
): Promise<{ user: VerifiedUser } | NextResponse> {
  const authResult = await verifyAuth(request);

  if (!authResult.success || !authResult.user) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error || 'Unauthorized',
      },
      { status: 401 }
    );
  }

  // Check if user has required role
  if (!requiredRoles.includes(authResult.user.role)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Insufficient permissions',
      },
      { status: 403 }
    );
  }

  return { user: authResult.user };
}
