/**
 * Server-side Authentication Utilities
 * Verify SSO tokens and check user roles in API routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';
import { logAction } from '@/lib/auditLog';

const logger = createLogger('Auth Verify');
const SSO_VERIFY_URL = process.env.SSO_URL
  ? `${process.env.SSO_URL}/api/auth/verify`
  : 'https://apps.iwa.web.tr/api/auth/verify';
const APP_CODE = process.env.SSO_APP_CODE || 'manumaestro';

// In-memory SSO verification cache (5 min TTL)
const SSO_CACHE_TTL = 5 * 60 * 1000;
const ssoCache = new Map<string, { result: AuthResult; expiresAt: number }>();

// Cleanup expired cache entries every 2 minutes
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of ssoCache.entries()) {
      if (now > entry.expiresAt) ssoCache.delete(key);
    }
  }, 2 * 60 * 1000);
}

/** Clear SSO verification cache (for testing) */
export function clearSsoCache() {
  ssoCache.clear();
}

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
    const token = extractToken(request);

    if (!token) {
      return {
        success: false,
        error: 'Kimlik doğrulama tokeni bulunamadı',
      };
    }

    // Check cache first (avoids SSO network call + DB upsert on every request)
    const cached = ssoCache.get(token);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
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

    const result: AuthResult = {
      success: true,
      user: {
        id: localUser.id,
        email: localUser.email,
        name: localUser.name,
        role: ssoRole,
      },
    };

    // Cache successful verification
    ssoCache.set(token, { result, expiresAt: Date.now() + SSO_CACHE_TTL });

    return result;
  } catch (error) {
    logger.error('Auth verification error:', error);
    return {
      success: false,
      error: 'Sunucu hatası',
    };
  }
}

/**
 * Extract bearer token or SSO cookie from request
 */
export function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  return bearerToken ?? request.cookies.get('sso_access_token')?.value ?? null;
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

  const logDenied = (reason: string) => {
    logAction({
      userId,
      userName: '',
      userEmail: '',
      action: 'ACCESS_DENIED',
      entityType: 'MarketplacePermission',
      description: `Pazar yeri erişimi reddedildi: ${marketplaceId} (${mode}) — ${reason}`,
      metadata: { marketplaceId, mode, userRole, reason },
    }).catch(() => {});
  };

  if (userRole === 'viewer' && mode === 'edit') {
    logDenied('viewer rolü ile düzenleme');
    return { allowed: false, reason: 'Görüntüleme yetkisine sahipsiniz, düzenleme yapamazsınız' };
  }

  // OPERATOR: check UserMarketplacePermission table
  const perm = await prisma.userMarketplacePermission.findUnique({
    where: { userId_marketplaceId: { userId, marketplaceId } },
  });

  if (!perm) {
    logDenied('pazar yeri izni yok');
    return { allowed: false, reason: 'Bu pazar yerine erişim izniniz yok' };
  }

  if (mode === 'view' && !perm.canView) {
    logDenied('görüntüleme izni yok');
    return { allowed: false, reason: 'Bu pazar yerini görüntüleme izniniz yok' };
  }

  if (mode === 'edit' && !perm.canEdit) {
    logDenied('düzenleme izni yok');
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

  const logDenied = (reason: string) => {
    logAction({
      userId,
      userName: '',
      userEmail: '',
      action: 'ACCESS_DENIED',
      entityType: 'CategoryPermission',
      description: `Kategori erişimi reddedildi: ${category} (${mode}) — ${reason}`,
      metadata: { category, mode, userRole, reason },
    }).catch(() => {});
  };

  if (userRole === 'viewer' && mode === 'edit') {
    logDenied('viewer rolü ile düzenleme');
    return { allowed: false, reason: 'Görüntüleme yetkisine sahipsiniz, düzenleme yapamazsınız' };
  }

  // OPERATOR: check UserCategoryPermission table
  const perm = await prisma.userCategoryPermission.findUnique({
    where: { userId_category: { userId, category } },
  });

  if (!perm) {
    logDenied('kategori izni yok');
    return { allowed: false, reason: 'Bu kategoriye erişim izniniz yok' };
  }

  if (mode === 'view' && !perm.canView) {
    logDenied('görüntüleme izni yok');
    return { allowed: false, reason: 'Bu kategoriyi görüntüleme izniniz yok' };
  }

  if (mode === 'edit' && !perm.canEdit) {
    logDenied('düzenleme izni yok');
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
    const endpoint = request.nextUrl.pathname;
    logAction({
      userId: authResult.user.id,
      userName: authResult.user.name,
      userEmail: authResult.user.email,
      action: 'ACCESS_DENIED',
      entityType: 'Auth',
      description: `Erişim reddedildi: ${endpoint} — rol: ${authResult.user.role}, gereken: ${requiredRoles.join('/')}`,
      metadata: { endpoint, method: request.method, userRole: authResult.user.role, requiredRoles },
    }).catch(() => {});
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
