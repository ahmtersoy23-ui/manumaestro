/**
 * Shelf Permission Helper
 * Depo bazlı raf/sipariş yetkilerini kontrol eder.
 * Pattern: lib/auth/shipmentPermission.ts (UserShipmentPermission paterniyle aynı).
 */

import { prisma } from '@/lib/db/prisma';

export type ShelfRoleLevel = 'VIEWER' | 'PACKER' | 'OPERATOR' | 'MANAGER' | 'ADMIN';

const ROLE_HIERARCHY: Record<ShelfRoleLevel, number> = {
  VIEWER: 0,
  PACKER: 1,
  OPERATOR: 1,
  MANAGER: 2,
  ADMIN: 3,
};

const ROLE_CAN: Record<ShelfRoleLevel, {
  view: boolean;
  // Raf işlemleri
  createShelf: boolean;
  deleteShelf: boolean;
  bulkCreateShelves: boolean;
  transferStock: boolean;       // raflar arası tekil/koli transferi
  crossWarehouseTransfer: boolean; // NJ ↔ Showroom
  openBox: boolean;
  breakBox: boolean;
  addManualBox: boolean;
  // Sipariş çıkışı
  createOutbound: boolean;       // DRAFT yarat / düzenle
  shipOutbound: boolean;         // DRAFT → SHIPPED (stok düşürür)
  cancelOutbound: boolean;
  // Hareket geri al
  undoOwnRecent: boolean;        // sadece kendi son N hareketi
  undoAny: boolean;              // herhangi bir hareketi
  // Eşleşmeyen kuyruğu
  resolveUnmatched: boolean;
  // Etiket yönetimi (Faz 1.1)
  uploadLabel: boolean; // kargo PDF / FNSKU / diğer yükle
  printLabel: boolean; // basıldı işaretle
  deleteLabel: boolean; // yüklenen etiketi sil
  // Yönetim
  managePermissions: boolean;
  manageWarehouseSettings: boolean;
}> = {
  VIEWER: {
    view: true,
    createShelf: false, deleteShelf: false, bulkCreateShelves: false,
    transferStock: false, crossWarehouseTransfer: false,
    openBox: false, breakBox: false, addManualBox: false,
    createOutbound: false, shipOutbound: false, cancelOutbound: false,
    undoOwnRecent: false, undoAny: false,
    resolveUnmatched: false,
    uploadLabel: false, printLabel: false, deleteLabel: false,
    managePermissions: false, manageWarehouseSettings: false,
  },
  PACKER: {
    view: true,
    createShelf: false, deleteShelf: false, bulkCreateShelves: false,
    transferStock: false, crossWarehouseTransfer: false,
    openBox: false, breakBox: false, addManualBox: false,
    createOutbound: true, shipOutbound: false, cancelOutbound: true,
    undoOwnRecent: false, undoAny: false,
    resolveUnmatched: false,
    uploadLabel: true, printLabel: true, deleteLabel: false,
    managePermissions: false, manageWarehouseSettings: false,
  },
  OPERATOR: {
    view: true,
    createShelf: true, deleteShelf: false, bulkCreateShelves: true,
    transferStock: true, crossWarehouseTransfer: true,
    openBox: true, breakBox: true, addManualBox: true,
    createOutbound: false, shipOutbound: false, cancelOutbound: false,
    undoOwnRecent: true, undoAny: false,
    resolveUnmatched: false,
    uploadLabel: true, printLabel: true, deleteLabel: false,
    managePermissions: false, manageWarehouseSettings: false,
  },
  MANAGER: {
    view: true,
    createShelf: true, deleteShelf: true, bulkCreateShelves: true,
    transferStock: true, crossWarehouseTransfer: true,
    openBox: true, breakBox: true, addManualBox: true,
    createOutbound: true, shipOutbound: true, cancelOutbound: true,
    undoOwnRecent: true, undoAny: true,
    resolveUnmatched: true,
    uploadLabel: true, printLabel: true, deleteLabel: true,
    managePermissions: false, manageWarehouseSettings: false,
  },
  ADMIN: {
    view: true,
    createShelf: true, deleteShelf: true, bulkCreateShelves: true,
    transferStock: true, crossWarehouseTransfer: true,
    openBox: true, breakBox: true, addManualBox: true,
    createOutbound: true, shipOutbound: true, cancelOutbound: true,
    undoOwnRecent: true, undoAny: true,
    resolveUnmatched: true,
    uploadLabel: true, printLabel: true, deleteLabel: true,
    managePermissions: true, manageWarehouseSettings: true,
  },
};

export type ShelfAction = keyof typeof ROLE_CAN['VIEWER'];

export const ALL_WAREHOUSES = ['ANKARA', 'NJ', 'SHOWROOM'] as const;

/**
 * Kullanıcının belirli bir depo için raf rolünü getir.
 * Manumaestro 'admin' SSO rolü = ADMIN (tüm depolar).
 */
export async function getShelfRole(
  userId: string,
  userSsoRole: string,
  warehouseCode: string
): Promise<ShelfRoleLevel | null> {
  if (userSsoRole === 'admin') return 'ADMIN';

  const permissions = await prisma.userShelfPermission.findMany({
    where: { userId, warehouseCode: { in: [warehouseCode, '*'] } },
    select: { role: true },
  });

  if (permissions.length === 0) return null;

  let best: ShelfRoleLevel = 'VIEWER';
  for (const p of permissions) {
    const role = p.role as ShelfRoleLevel;
    if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[best]) best = role;
  }
  return best;
}

export function canDoShelfAction(role: ShelfRoleLevel | null, action: ShelfAction): boolean {
  if (!role) return false;
  return ROLE_CAN[role][action];
}

/**
 * Kullanıcının erişebileceği depo kodları
 */
export async function getAccessibleWarehouses(userId: string, userSsoRole: string): Promise<string[]> {
  if (userSsoRole === 'admin') return [...ALL_WAREHOUSES];

  const permissions = await prisma.userShelfPermission.findMany({
    where: { userId },
    select: { warehouseCode: true },
  });

  const codes = permissions.map((p) => p.warehouseCode);
  if (codes.includes('*')) return [...ALL_WAREHOUSES];
  return [...new Set(codes)];
}
