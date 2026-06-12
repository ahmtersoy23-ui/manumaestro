/**
 * PendingItemsTable — bekleyen item'ları render eden tablo (pending tab).
 *
 * Deniz: Miktar tek kolon. Kara/Hava: Talep + Gönderilen kolonları (kısmi
 * gönderim için). Row'lar `PendingItemRow` (zaten ayrı). Bu component
 * sadece tablo + thead + tbody + empty state.
 */

import { Check, CheckSquare, Square } from 'lucide-react';
import { PendingItemRow } from './PendingItemRow';
import type { BoxFormData, ShipmentItem, ShipmentBox } from '@/lib/shipments/types';

interface Props {
  // Data
  items: ShipmentItem[];        // filteredPendingItems
  boxes: ShipmentBox[];
  hasAnyPending: boolean;       // pendingItems.length > 0 (filter öncesi)

  // Flags
  isSea: boolean;
  isActive: boolean;

  // Permissions
  canBoxes: boolean;
  canPack: boolean;
  canSend: boolean;
  canDelete: boolean;

  // Selection state
  expandedItemId: string | null;
  selectedIds: Set<string>;
  togglingId: string | null;
  packedPendingCount: number;

  // Kara/hava: gönderilecek miktar override
  sendQtyOverrides: Record<string, number>;

  // Callbacks
  onSelectAllPacked: () => void;
  onTogglePacked: (itemId: string) => void;
  onToggleSelect: (itemId: string) => void;
  onSetExpandedItemId: (itemId: string | null) => void;
  onCreateBox: (form: BoxFormData, itemId: string) => Promise<ShipmentBox | null>;
  onDeleteBox: (boxId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onFnskuSaved: (itemId: string, fnsku: string) => void;
  onPrintLabel: (item: ShipmentItem, count: number) => void;
  onSendQtyChange: (itemId: string, qty: number) => void;
}

export function PendingItemsTable({
  items, boxes, hasAnyPending,
  isSea, isActive,
  canBoxes, canPack, canSend, canDelete,
  expandedItemId, selectedIds, togglingId, packedPendingCount,
  sendQtyOverrides,
  onSelectAllPacked, onTogglePacked, onToggleSelect, onSetExpandedItemId,
  onCreateBox, onDeleteBox, onDeleteItem, onFnskuSaved, onPrintLabel, onSendQtyChange,
}: Props) {
  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      {hasAnyPending ? (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="w-12 px-3 py-3">
                {isActive && !isSea && canSend && packedPendingCount > 0 && (
                  <button onClick={onSelectAllPacked} className="text-gray-600 hover:text-purple-600" title="Hazırları seç">
                    {packedPendingCount > 0 && [...selectedIds].length >= packedPendingCount
                      ? <CheckSquare className="w-5 h-5" />
                      : <Square className="w-5 h-5" />}
                  </button>
                )}
              </th>
              <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Eklenme</th>
              {!isSea ? (
                <>
                  <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Talep</th>
                  <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Gönderilen</th>
                </>
              ) : (
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
              )}
              <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">T. Desi</th>
              {isActive && <th className="w-10"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(item => {
              const itemDesi = (item.desi ?? 0) * item.quantity;
              const isExpanded = expandedItemId === item.id;
              const itemBoxes = boxes.filter(b => b.shipmentItemId === item.id);
              return (
                <PendingItemRow
                  key={item.id}
                  item={item}
                  itemDesi={itemDesi}
                  itemBoxes={itemBoxes}
                  isSea={isSea}
                  isActive={isActive}
                  isExpanded={isExpanded}
                  isSelected={selectedIds.has(item.id)}
                  togglingId={togglingId}
                  canBoxes={canBoxes}
                  canPack={canPack}
                  canSend={canSend}
                  canDelete={canDelete}
                  onTogglePacked={() => onTogglePacked(item.id)}
                  onToggleSelect={() => onToggleSelect(item.id)}
                  onToggleExpand={() => onSetExpandedItemId(isExpanded ? null : item.id)}
                  onCreateBox={(form) => onCreateBox(form, item.id)}
                  onDeleteBox={onDeleteBox}
                  onDeleteItem={() => onDeleteItem(item.id)}
                  onFnskuSaved={onFnskuSaved}
                  onPrintLabel={onPrintLabel}
                  sendQty={!isSea ? sendQtyOverrides[item.id] : undefined}
                  onSendQtyChange={!isSea ? (qty) => onSendQtyChange(item.id, qty) : undefined}
                />
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="text-center py-12">
          <Check className="w-10 h-10 text-green-300 mx-auto mb-3" />
          <p className="text-gray-500">Bekleyen ürün yok</p>
        </div>
      )}
    </div>
  );
}
