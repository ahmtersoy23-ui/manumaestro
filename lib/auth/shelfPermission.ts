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
  // Cycle counting (Faz 1.3)
  cycleCountPerform: boolean; // task başlat, sayım gir, tamamla
  cycleCountResolve: boolean; // discrepancy adjust + manuel inventory düzeltme
  cycleCountGenerate: boolean; // task generator manuel tetikleme
  // Yönetim
  managePermissions: boolean;
  manageWarehouseSettings: boolean;
  // Stok silme — kritik audit'li aksiyon, sadece ADMIN
  deleteStock: boolean;
  // Tekil/koli adet manuel düzeltme (sayım dışı) — sadece ADMIN
  editStockQuantity: boolean;
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
    cycleCountPerform: false, cycleCountResolve: false, cycleCountGenerate: false,
    managePermissions: false, manageWarehouseSettings: false,
    deleteStock: false,
    editStockQuantity: false,
  },
  PACKER: {
    view: true,
    createShelf: false, deleteShelf: false, bulkCreateShelves: false,
    transferStock: false, crossWarehouseTransfer: false,
    openBox: false, breakBox: false, addManualBox: false,
    createOutbound: true, shipOutbound: true, cancelOutbound: true,
    undoOwnRecent: false, undoAny: false,
    resolveUnmatched: false,
    uploadLabel: true, printLabel: true, deleteLabel: false,
    cycleCountPerform: true, cycleCountResolve: false, cycleCountGenerate: false,
    managePermissions: false, manageWarehouseSettings: false,
    deleteStock: false,
    editStockQuantity: false,
  },
  OPERATOR: {
    view: true,
    createShelf: true, deleteShelf: false, bulkCreateShelves: true,
    transferStock: true, crossWarehouseTransfer: true,
    openBox: true, breakBox: true, addManualBox: true,
    createOutbound: false, shipOutbound: true, cancelOutbound: false,
    undoOwnRecent: true, undoAny: false,
    resolveUnmatched: false,
    uploadLabel: true, printLabel: true, deleteLabel: false,
    cycleCountPerform: true, cycleCountResolve: false, cycleCountGenerate: false,
    managePermissions: false, manageWarehouseSettings: false,
    deleteStock: false,
    editStockQuantity: false,
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
    cycleCountPerform: true, cycleCountResolve: true, cycleCountGenerate: true,
    managePermissions: false, manageWarehouseSettings: false,
    deleteStock: false,
    editStockQuantity: false,
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
    cycleCountPerform: true, cycleCountResolve: true, cycleCountGenerate: true,
    managePermissions: true, manageWarehouseSettings: true,
    deleteStock: true,
    editStockQuantity: true,
  },
};

export type ShelfAction = keyof typeof ROLE_CAN['VIEWER'];

export const ALL_WAREHOUSES = ['ANKARA', 'NJ', 'SHOWROOM', 'NL'] as const;

// Public warehouses — özel permission gerekmez, herkes VIEWER olarak görür.
// Edit/COUNTER/EDITOR yetkisi isteyen kullanıcılar yine user_shelf_permissions
// üzerinden eklenmeli. 2026-05-30: NL Depo genel kullanıma açıldı (SHELF_PRIMARY
// + sadece POOL raf — operatörlerin görmesi yeterli).
export const PUBLIC_WAREHOUSES = ['NL'] as const;

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

  // Public warehouse: özel kayıt yoksa VIEWER varsayılan (örn. NL).
  if (permissions.length === 0) {
    return (PUBLIC_WAREHOUSES as readonly string[]).includes(warehouseCode) ? 'VIEWER' : null;
  }

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
  // Public warehouse'lar (NL) her zaman dahil — özel permission gerekmez.
  return [...new Set([...codes, ...PUBLIC_WAREHOUSES])];
}
