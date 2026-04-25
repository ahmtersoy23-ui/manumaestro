/**
 * Shelf role requirement helpers for API routes.
 * Pattern: lib/auth/requireShipmentRole.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verify';
import {
  canDoShelfAction,
  getAccessibleWarehouses,
  getShelfRole,
  ShelfAction,
  ShelfRoleLevel,
} from './shelfPermission';

interface AuthSuccess {
  user: { id: string; name: string; email: string; role: string };
  shelfRole: ShelfRoleLevel;
}

/**
 * Belirli bir depo + aksiyon için yetkiyi doğrula.
 */
export async function requireShelfAction(
  request: NextRequest,
  warehouseCode: string,
  action: ShelfAction
): Promise<AuthSuccess | NextResponse> {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Yetkisiz erişim' },
      { status: 401 }
    );
  }

  const shelfRole = await getShelfRole(auth.user.id, auth.user.role, warehouseCode);

  if (!shelfRole || !canDoShelfAction(shelfRole, action)) {
    return NextResponse.json(
      { success: false, error: 'Bu raf işlemi için yetkiniz yok' },
      { status: 403 }
    );
  }

  return { user: auth.user, shelfRole };
}

/**
 * Kullanıcı en az bir deponun raf sayfasını görebilir mi?
 */
export async function requireShelfView(
  request: NextRequest
): Promise<(AuthSuccess & { accessibleWarehouses: string[] }) | NextResponse> {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Yetkisiz erişim' },
      { status: 401 }
    );
  }

  if (auth.user.role === 'admin') {
    return {
      user: auth.user,
      shelfRole: 'ADMIN',
      accessibleWarehouses: ['ANKARA', 'NJ', 'SHOWROOM'],
    };
  }

  const warehouses = await getAccessibleWarehouses(auth.user.id, auth.user.role);

  if (warehouses.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Hiçbir depo için erişim yetkiniz yok' },
      { status: 403 }
    );
  }

  return { user: auth.user, shelfRole: 'VIEWER', accessibleWarehouses: warehouses };
}
