/**
 * Server-side Authentication Utilities
 * Verify SSO tokens and check user roles in API routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Auth Verify');
const SSO_VERIFY_URL = 'https://apps.iwa.web.tr/api/auth/verify';
const APP_CODE = 'manumaestro';

/** Map SSO role string to Prisma UserRole enum */
function mapSSORole(ssoRole: string): UserRole {
  switch (ssoRole) {
    case 'admin': return UserRole.ADMIN;
    case 'editor': return UserRole.OPERATOR;
    default: return UserRole.VIEWER;
  }
}

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
    // Get token from Authorization header (mobile) or cookie (web)
    const authHeader = request.headers.get('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    const token = bearerToken ?? request.cookies.get('sso_access_token')?.value;

    if (!token) {
      return {
        success: false,
        error: 'Kimlik doğrulama tokeni bulunamadı',
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
        error: 'Token doğrulaması başarısız',
      };
    }

    const data = await response.json();

    if (!data.success) {
      return {
        success: false,
        error: 'Geçersiz token',
      };
    }

    // Upsert user in local DB so FK constraints work
    const ssoRole = data.data.role || 'viewer';
    const localUser = await prisma.user.upsert({
      where: { email: data.data.user.email },
      update: {
        name: data.data.user.name,
        role: mapSSORole(ssoRole),
      },
      create: {
        email: data.data.user.email,
        name: data.data.user.name,
        passwordHash: 'SSO_USER',
        role: mapSSORole(ssoRole),
        isActive: true,
      },
    });

    return {
      success: true,
      user: {
        id: localUser.id,
        email: localUser.email,
        name: localUser.name,
        role: ssoRole,
      },
    };
  } catch (error) {
    logger.error('Auth verification error:', error);
    return {
      success: false,
      error: 'Sunucu hatası',
    };
  }
}

/**
 * Check if user has permission to view/edit a specific marketplace
 * ADMIN bypasses all checks. OPERATOR must have an explicit UserMarketplacePermission row.
 */
export async function checkMarketplacePermission(
  userId: string,
  userRole: 'admin' | 'editor' | 'viewer',
  marketplaceId: string,
  mode: 'view' | 'edit'
): Promise<{ allowed: boolean; reason?: string }> {
  if (userRole === 'admin') return { allowed: true };

  if (userRole === 'viewer' && mode === 'edit') {
    return { allowed: false, reason: 'Görüntüleme yetkisine sahipsiniz, düzenleme yapamazsınız' };
  }

  // OPERATOR: check UserMarketplacePermission table
  const perm = await prisma.userMarketplacePermission.findUnique({
    where: { userId_marketplaceId: { userId, marketplaceId } },
  });

  if (!perm) {
    return { allowed: false, reason: 'Bu pazar yerine erişim izniniz yok' };
  }

  if (mode === 'view' && !perm.canView) {
    return { allowed: false, reason: 'Bu pazar yerini görüntüleme izniniz yok' };
  }

  if (mode === 'edit' && !perm.canEdit) {
    return { allowed: false, reason: 'Bu pazar yerini düzenleme izniniz yok' };
  }

  return { allowed: true };
}

/**
 * Check if user has permission to view/edit a specific category
 * ADMIN bypasses all checks. OPERATOR must have an explicit UserCategoryPermission row.
 */
export async function checkCategoryPermission(
  userId: string,
  userRole: 'admin' | 'editor' | 'viewer',
  category: string,
  mode: 'view' | 'edit'
): Promise<{ allowed: boolean; reason?: string }> {
  if (userRole === 'admin') return { allowed: true };

  if (userRole === 'viewer' && mode === 'edit') {
    return { allowed: false, reason: 'Görüntüleme yetkisine sahipsiniz, düzenleme yapamazsınız' };
  }

  // OPERATOR: check UserCategoryPermission table
  const perm = await prisma.userCategoryPermission.findUnique({
    where: { userId_category: { userId, category } },
  });

  if (!perm) {
    return { allowed: false, reason: 'Bu kategoriye erişim izniniz yok' };
  }

  if (mode === 'view' && !perm.canView) {
    return { allowed: false, reason: 'Bu kategoriyi görüntüleme izniniz yok' };
  }

  if (mode === 'edit' && !perm.canEdit) {
    return { allowed: false, reason: 'Bu kategoriyi düzenleme izniniz yok' };
  }

  return { allowed: true };
}

/**
 * Check if user has permission to view/edit warehouse stock
 * ADMIN bypasses all checks.
 */
export async function checkStockPermission(
  userId: string,
  userRole: 'admin' | 'editor' | 'viewer',
  mode: 'view' | 'edit'
): Promise<{ allowed: boolean; reason?: string }> {
  if (userRole === 'admin') return { allowed: true };

  const perm = await prisma.userStockPermission.findUnique({
    where: { userId },
  });

  if (!perm) {
    return { allowed: false, reason: 'Depo stoğu erişim izniniz yok' };
  }

  if (mode === 'view' && !perm.canView) {
    return { allowed: false, reason: 'Depo stoğunu görüntüleme izniniz yok' };
  }

  if (mode === 'edit' && !perm.canEdit) {
    return { allowed: false, reason: 'Depo stoğunu düzenleme izniniz yok' };
  }

  return { allowed: true };
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
        error: authResult.error || 'Yetkisiz erişim',
      },
      { status: 401 }
    );
  }

  // Check if user has required role
  if (!requiredRoles.includes(authResult.user.role)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Yetersiz yetki',
      },
      { status: 403 }
    );
  }

  return { user: authResult.user };
}
