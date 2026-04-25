/**
 * Shipment role requirement helper for API routes
 * Replaces requireRole(['admin']) with fine-grained shipment permissions
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verify';
import { getShipmentRole, canDoAction, ShipmentAction, ShipmentRoleLevel } from './shipmentPermission';

interface AuthSuccess {
  user: { id: string; name: string; email: string; role: string };
  shipmentRole: ShipmentRoleLevel;
}

/**
 * Verify user has shipment permission for a specific action on a destination
 * Returns user info + shipment role, or NextResponse error
 */
export async function requireShipmentAction(
  request: NextRequest,
  destinationTab: string,
  action: ShipmentAction
): Promise<AuthSuccess | NextResponse> {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json({ success: false, error: auth.error || 'Yetkisiz erisim' }, { status: 401 });
  }

  const shipmentRole = await getShipmentRole(auth.user.id, auth.user.role, destinationTab);

  if (!shipmentRole || !canDoAction(shipmentRole, action)) {
    return NextResponse.json(
      { success: false, error: 'Bu sevkiyat islemi icin yetkiniz yok' },
      { status: 403 }
    );
  }

  return { user: auth.user, shipmentRole };
}

/**
 * Verify user can at least view shipments (any destination)
 */
export async function requireShipmentView(
  request: NextRequest
): Promise<(AuthSuccess & { accessibleTabs: string[] }) | NextResponse> {
  const auth = await verifyAuth(request);
  if (!auth.success || !auth.user) {
    return NextResponse.json({ success: false, error: auth.error || 'Yetkisiz erisim' }, { status: 401 });
  }

  // Admin gorebilir
  if (auth.user.role === 'admin') {
    return {
      user: auth.user,
      shipmentRole: 'MANAGER',
      accessibleTabs: ['US', 'US_SHOWROOM', 'UK', 'EU', 'NL', 'AU', 'ZA'],
    };
  }

  // Kullanicinin erisebilecegi destinasyonlar
  const { getAccessibleDestinations } = await import('./shipmentPermission');
  const tabs = await getAccessibleDestinations(auth.user.id, auth.user.role);

  if (tabs.length === 0) {
    return NextResponse.json({ success: false, error: 'Sevkiyat erisim yetkiniz yok' }, { status: 403 });
  }

  return { user: auth.user, shipmentRole: 'VIEWER', accessibleTabs: tabs };
}
