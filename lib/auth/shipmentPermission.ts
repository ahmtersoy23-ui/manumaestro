/**
 * Shipment Permission Helper
 * Checks user's shipment role for a given destination
 */

import { prisma } from '@/lib/db/prisma';

export type ShipmentRoleLevel = 'VIEWER' | 'ROUTER' | 'PACKER' | 'MANAGER';

const ROLE_HIERARCHY: Record<ShipmentRoleLevel, number> = {
  VIEWER: 0,
  ROUTER: 1,
  PACKER: 1,
  MANAGER: 2,
};

// ROUTER ve PACKER ayni seviye ama farkli yetkiler
const ROLE_CAN: Record<ShipmentRoleLevel, {
  view: boolean;
  createShipment: boolean;
  routeItems: boolean;
  deleteItems: boolean;
  setDestination: boolean; // FBA/Depo
  manageBoxes: boolean;
  packItems: boolean;
  sendItems: boolean;
  unsendItems: boolean;
  closeShipment: boolean;
}> = {
  VIEWER: {
    view: true, createShipment: false, routeItems: false, deleteItems: false,
    setDestination: false, manageBoxes: false, packItems: false, sendItems: false, unsendItems: false, closeShipment: false,
  },
  ROUTER: {
    view: true, createShipment: false, routeItems: true, deleteItems: true,
    setDestination: true, manageBoxes: false, packItems: false, sendItems: false, unsendItems: false, closeShipment: false,
  },
  PACKER: {
    view: true, createShipment: false, routeItems: false, deleteItems: false,
    setDestination: false, manageBoxes: true, packItems: true, sendItems: true, unsendItems: true, closeShipment: false,
  },
  MANAGER: {
    view: true, createShipment: true, routeItems: true, deleteItems: true,
    setDestination: true, manageBoxes: true, packItems: true, sendItems: true, unsendItems: true, closeShipment: true,
  },
};

export type ShipmentAction = keyof typeof ROLE_CAN['VIEWER'];

/**
 * Kullanicinin belirli bir destinasyon icin sevkiyat rolunu getir
 * Admin her zaman MANAGER
 */
export async function getShipmentRole(
  userId: string,
  userRole: string,
  destinationTab: string
): Promise<ShipmentRoleLevel | null> {
  // Admin = MANAGER (tum destinasyonlar)
  if (userRole === 'admin') return 'MANAGER';

  // Kullanici izinlerini kontrol et
  const permissions = await prisma.userShipmentPermission.findMany({
    where: { userId, destinationTab: { in: [destinationTab, '*'] } },
    select: { role: true },
  });

  if (permissions.length === 0) return null;

  // En yuksek rolu sec
  let best: ShipmentRoleLevel = 'VIEWER';
  for (const p of permissions) {
    const role = p.role as ShipmentRoleLevel;
    if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[best]) best = role;
    // PACKER ve ROUTER ayni seviye — ikisi de varsa MANAGER gibi davran
    if (permissions.some(pp => pp.role === 'PACKER') && permissions.some(pp => pp.role === 'ROUTER')) {
      best = 'MANAGER';
    }
  }

  return best;
}

/**
 * Kullanicinin belirli bir aksiyona izni var mi
 */
export function canDoAction(role: ShipmentRoleLevel | null, action: ShipmentAction): boolean {
  if (!role) return false;
  return ROLE_CAN[role][action];
}

/**
 * Kullanicinin erisebilecegi tum destinasyonlari getir
 */
export async function getAccessibleDestinations(
  userId: string,
  userRole: string
): Promise<string[]> {
  if (userRole === 'admin') return ['US', 'UK', 'EU', 'NL', 'AU', 'ZA'];

  const permissions = await prisma.userShipmentPermission.findMany({
    where: { userId },
    select: { destinationTab: true },
  });

  const tabs = permissions.map(p => p.destinationTab);
  if (tabs.includes('*')) return ['US', 'UK', 'EU', 'NL', 'AU', 'ZA'];
  return [...new Set(tabs)];
}
