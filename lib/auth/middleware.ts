/**
 * SSO Authentication Middleware for API Routes
 * Verifies JWT tokens and enforces role-based access control
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SSO Auth Middleware');
const SSO_URL = process.env.SSO_URL || 'https://apps.iwa.web.tr';
const APP_CODE = process.env.SSO_APP_CODE || 'manumaestro';

export interface AuthenticatedRequest extends NextRequest {
  user?: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
  userRole?: 'admin' | 'editor' | 'viewer';
}

/**
 * Verify SSO token and return user data
 */
async function verifySSOToken(token: string) {
  try {
    const response = await fetch(`${SSO_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app_code: APP_CODE }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    logger.error('SSO verification error:', error);
    return null;
  }
}

/**
 * Middleware to authenticate API requests
 */
export async function authenticateSSO(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Authorization token required' },
      { status: 401 }
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const authData = await verifySSOToken(token);

  if (!authData) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }

  // Return auth data to be used in route handler
  return {
    user: authData.user,
    role: authData.role,
  };
}

/**
 * Check if user has required role
 */
export function requireRole(userRole: string, allowedRoles: string[]): boolean {
  return allowedRoles.includes(userRole);
}

/**
 * Return 403 error for insufficient permissions
 */
export function forbiddenResponse() {
  return NextResponse.json(
    {
      error: 'Insufficient permissions',
    },
    { status: 403 }
  );
}
