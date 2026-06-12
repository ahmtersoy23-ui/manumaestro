/**
 * PendingItemRow — sevkiyat aktif sekmesindeki kalem satırı.
 *
 * Deniz: koli expand + box totals renk kodlaması.
 * Kara/Hava: packed checkbox + select for batch send.
 */

import {
  Check, Package, Square, CheckSquare, ChevronDown, ChevronRight, Loader2, Printer, X,
} from 'lucide-react';
import { InlineFnskuInput } from './InlineFnskuInput';
import { BoxEntryPanel } from './BoxEntryPanel';
import { useInputDialog } from '@/components/ui/InputDialog';
import { NL_DEPOT_LABEL } from '@/lib/marketplaceRegions';
import type { BoxFormData, ShipmentItem, ShipmentBox } from '@/lib/shipments/types';

interface Props {
  item: ShipmentItem;
  itemDesi: number;
  itemBoxes: ShipmentBox[];
  isSea: boolean;
  isActive: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  togglingId: string | null;
  canBoxes: boolean;
  canPack: boolean;
  canSend: boolean;
  canDelete: boolean;
  onTogglePacked: () => void;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onCreateBox: (form: BoxFormData) => Promise<ShipmentBox | null>;
  onDeleteBox: (boxId: string) => void;
  onDeleteItem: () => void;
  onFnskuSaved: (itemId: string, fnsku: string) => void;
  onPrintLabel: (item: ShipmentItem, count: number) => void;
  sendQty?: number;
  onSendQtyChange?: (qty: number) => void;
}

export function PendingItemRow({
  item, itemDesi, itemBoxes, isSea, isActive, isExpanded, isSelected, togglingId,
  canBoxes, canPack, canSend, canDelete,
  onTogglePacked, onToggleSelect, onToggleExpand, onCreateBox, onDeleteBox, onDeleteItem, onFnskuSaved,
  onPrintLabel, sendQty, onSendQtyChange,
}: Props) {
  const inputDialog = useInputDialog();
  // NL Depo'ya giden kalem (NL Karayolu, EU tab altında) → Bol EAN-13 etiketi.
  const isNl = item.destinationLabel === NL_DEPOT_LABEL;
  // Deniz renk kodlama: kolilerdeki toplam adet vs item miktar
  const boxQtyTotal = itemBoxes.reduce((s, b) => s + b.quantity, 0);
  const rowBg = isSea
    ? (itemBoxes.length === 0 ? '' : boxQtyTotal >= item.quantity ? 'bg-green-50' : 'bg-amber-50/60')
    : (item.packed ? 'bg-green-50/50' : '');

  return (
    <>
      <tr className={`hover:bg-gray-50 ${rowBg}`}>
        <td className="px-3 py-3 text-center">
          {isActive && isSea && canBoxes ? (
            <button onClick={onToggleExpand} className="hover:scale-110 transition-transform">
              {isExpanded ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
            </button>
          ) : isActive && !isSea ? (
            <div className="flex items-center gap-1 justify-center">
              {item.packed && canSend && (
                <button onClick={onToggleSelect} className="hover:scale-110 transition-transform">
                  {isSelected ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5 text-gray-300" />}
                </button>
              )}
              {canPack && (togglingId === item.id ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                <button onClick={onTogglePacked} className="hover:scale-110 transition-transform" title={item.packed ? 'Hazır' : 'Hazırla'}>
                  {item.packed ? <Check className="w-4 h-4 text-green-600" /> : <Package className="w-4 h-4 text-gray-300" />}
                </button>
              ))}
            </div>
          ) : item.packed ? <Check className="w-5 h-5 text-green-600" /> : null}
        </td>
        <td className={`px-3 py-3 font-mono text-sm ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.iwasku}</td>
        <td className="px-3 py-3">
          {item.fnsku
            ? <span className={`font-mono text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.fnsku}</span>
            : item.marketplace?.code?.startsWith('AMZN')
              ? <InlineFnskuInput item={item} onSaved={onFnskuSaved} />
              : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-3"><div className={`text-xs leading-tight line-clamp-2 ${item.packed ? 'text-green-700' : 'text-gray-700'}`}>{item.productName || '—'}</div></td>
        <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.productCategory || '—'}</td>
        <td className={`px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-600'}`}>{item.destinationLabel}</td>
        <td className={`px-3 py-3 text-xs ${item.packed ? 'text-green-600' : 'text-gray-500'}`}>
          {new Date(item.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
        </td>
        {!isSea && onSendQtyChange ? (
          <>
            <td className={`text-center px-3 py-3 text-sm ${item.packed ? 'text-green-600' : 'text-gray-500'}`}>{item.quantity}</td>
            <td className="text-center px-3 py-3">
              <input
                type="number"
                min={1}
                value={sendQty ?? ''}
                onChange={e => {
                  const raw = parseInt(e.target.value);
                  onSendQtyChange(isNaN(raw) ? 0 : Math.max(1, raw));
                }}
                placeholder="—"
                className="w-16 px-2 py-1 text-sm text-center border rounded focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
            </td>
          </>
        ) : (
          <td className={`text-center px-3 py-3 font-semibold ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{item.quantity}</td>
        )}
        <td className={`text-center px-3 py-3 font-medium ${item.packed ? 'text-green-800' : 'text-gray-900'}`}>{itemDesi > 0 ? Math.round(itemDesi).toLocaleString('tr-TR') : '—'}</td>
        {isActive && (
          <td className="px-2 py-3 text-center">
            <div className="flex items-center gap-1 justify-center">
              {/* NL: Bol EAN-13 etiketi (bolEan varsa); diğer: FNSKU/IWASKU CODE128 */}
              {!isSea && (isNl ? !!item.bolEan : !!(item.fnsku || item.iwasku)) && (
                <button onClick={async () => {
                  const input = await inputDialog({
                    title: isNl ? 'Bol EAN etiketi yazdır' : 'Etiket yazdır',
                    message: `${item.iwasku} — Kaç etiket basılsın?`,
                    defaultValue: String(item.quantity),
                    inputType: 'number',
                    min: 1,
                    confirmLabel: 'Yazdır',
                  });
                  if (input) { const n = parseInt(input); if (n > 0) onPrintLabel(item, n); }
                }} className="text-gray-300 hover:text-blue-600 transition-colors" title={isNl ? 'Bol EAN etiketi yazdır' : 'Etiket yazdır'}>
                  <Printer className="w-4 h-4" />
                </button>
              )}
              {!isSea && isNl && !item.bolEan && (
                <span className="text-[10px] font-medium text-amber-600 whitespace-nowrap" title="Bol mappings'te EAN eşlemesi yok — etiket basılamaz">Bol EAN yok</span>
              )}
              {canDelete && (
                <button onClick={onDeleteItem} className="text-red-300 hover:text-red-600 transition-colors" title="Sevkiyattan çıkar"><X className="w-4 h-4" /></button>
              )}
            </div>
          </td>
        )}
      </tr>
      {isExpanded && isActive && isSea && canBoxes && (
        <tr><td colSpan={11} className="px-4 py-3 bg-blue-50/50 border-t border-blue-100">
          <BoxEntryPanel item={item} existingBoxes={itemBoxes} onCreateBox={onCreateBox} onDeleteBox={onDeleteBox} />
        </td></tr>
      )}
    </>
  );
}
