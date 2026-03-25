/**
 * SSO User Sync API
 * POST: Fetch ManuMaestro users from SSO and upsert into local DB
 */

import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireRole, extractToken } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SSO Sync');
const SSO_ADMIN_USERS_URL = process.env.SSO_URL
  ? `${process.env.SSO_URL}/api/admin/users`
  : 'https://apps.iwa.web.tr/api/admin/users';
const APP_CODE = 'manumaestro';

function mapSSORole(ssoRole: string): UserRole {
  switch (ssoRole) {
    case 'admin': return UserRole.ADMIN;
    case 'editor': return UserRole.OPERATOR;
    default: return UserRole.VIEWER;
  }
}

interface SSOAppRole {
  app_code: string;
  role_code: string;
}

interface SSOUser {
  email: string;
  name: string;
  is_active: boolean;
  apps: SSOAppRole[] | null;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    // Forward admin's SSO token to fetch all users
    const token = extractToken(request);

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'SSO token bulunamadı' },
        { status: 401 }
      );
    }

    const ssoResponse = await fetch(SSO_ADMIN_USERS_URL, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!ssoResponse.ok) {
      logger.error('SSO users fetch failed:', ssoResponse.status);
      return NextResponse.json(
        { success: false, error: 'SSO kullanıcıları getirilemedi' },
        { status: 502 }
      );
    }

    const ssoData = await ssoResponse.json();
    if (!ssoData.success || !Array.isArray(ssoData.data)) {
      return NextResponse.json(
        { success: false, error: 'SSO yanıtı geçersiz' },
        { status: 502 }
      );
    }

    // Filter users who have access to ManuMaestro
    const manuUsers = (ssoData.data as SSOUser[]).filter(u =>
      u.apps?.some((a: SSOAppRole) => a.app_code === APP_CODE)
    );

    let synced = 0;
    for (const ssoUser of manuUsers) {
      const appRole = ssoUser.apps!.find((a: SSOAppRole) => a.app_code === APP_CODE)!;
      const role = mapSSORole(appRole.role_code);

      await prisma.user.upsert({
        where: { email: ssoUser.email },
        update: {
          name: ssoUser.name,
          role,
          isActive: ssoUser.is_active,
        },
        create: {
          email: ssoUser.email,
          name: ssoUser.name,
          passwordHash: 'SSO_USER',
          role,
          isActive: ssoUser.is_active,
        },
      });
      synced++;
    }

    logger.info(`SSO sync completed: ${synced} users synced`);

    return NextResponse.json({
      success: true,
      data: { synced },
    });
  } catch (error) {
    return errorResponse(error, 'SSO senkronizasyonu başarısız');
  }
}
