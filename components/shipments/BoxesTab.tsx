/**
 * BoxesTab — sevkiyat koli yönetimi tabı (sadece deniz akışında görünür).
 *
 * Içerik:
 *  - Filter/action bar: Ek Koli, Toplu FBA, Excel + Shipmate export, search,
 *    kategori/hedef/pazar filtreleri, bulk destination set butonları
 *  - ExtraBoxForm + BulkFbaPanel (parent state, ayrı component'ler)
 *  - Boxes tablosu: select all, koli no, hedef, IWASKU, FNSKU sync,
 *    ürün adı, pazar, adet, EditableBoxCell (W/D/H/Wt), desi, copy,
 *    print, delete butonları
 *
 * Network ve state hep parent'ta — bu component sadece presentation.
 */

import { Plus, Download, Search, X, Loader2, CheckSquare, Square, RefreshCw, Copy, Printer, Package } from 'lucide-react';
import { ExtraBoxForm } from './ExtraBoxForm';
import { EditableBoxCell } from './EditableBoxCell';
import { BulkFbaPanel } from './BulkFbaPanel';
import type { BoxFormData, ShipmentBox } from '@/lib/shipments/types';

interface Props {
  shipmentId: string;
  boxes: ShipmentBox[];               // raw (length kontrolleri + Tümünü seç)
  filteredBoxes: ShipmentBox[];

  // Flags / permissions
  isActive: boolean;
  canBoxes: boolean;
  canDest: boolean;
  canEdit: boolean;

  // UI state — extra box + bulk fba
  showExtraBox: boolean;
  showBulkFba: boolean;
  bulkFbaText: string;
  bulkFbaResult: { updated: number; notFound?: string[] } | null;
  settingDest: boolean;

  // Search + filters
  search: string;
  categoryFilter: string;
  destFilter: string;
  marketFilter: string;
  categories: string[];
  markets: string[];

  // Selection + side state
  selectedBoxIds: Set<string>;
  syncingFnskuBoxId: string | null;
  editingCell: { boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null;
  printedBoxIds: Set<string>;

  // Derived maps
  mktCodeToName: Map<string, string>;
  donorMap: Map<string, ShipmentBox>;

  // Setters / callbacks
  onSearchChange: (search: string) => void;
  onCategoryFilterChange: (filter: string) => void;
  onDestFilterChange: (filter: string) => void;
  onMarketFilterChange: (filter: string) => void;
  onToggleExtraBox: () => void;
  onToggleBulkFba: () => void;
  onBulkFbaTextChange: (text: string) => void;
  onBulkFbaSubmit: (dest: 'FBA' | 'DEPO' | 'SHOWROOM') => void;
  onCloseBulkFba: () => void;
  onExportBoxes: () => void;
  onExportShipmate: () => void;
  onSelectAllBoxes: () => void;
  onToggleBoxSelect: (boxId: string) => void;
  onSetDestination: (dest: 'FBA' | 'DEPO' | 'SHOWROOM') => void;
  onCreateBox: (form: BoxFormData, itemId: string | null) => Promise<ShipmentBox | null>;
  onCloseExtraBox: () => void;
  onSyncFnsku: (boxId: string) => void;
  onCopyDimensions: (target: ShipmentBox, donor: ShipmentBox) => void;
  onPrintBoxLabel: (box: ShipmentBox) => void;
  onDeleteBox: (boxId: string) => void;
  onEditingCellChange: (cell: { boxId: string; field: 'width' | 'depth' | 'height' | 'weight' } | null) => void;
  onBoxUpdated: () => void;
}

export function BoxesTab({
  shipmentId,
  boxes, filteredBoxes,
  isActive, canBoxes, canDest, canEdit,
  showExtraBox, showBulkFba, bulkFbaText, bulkFbaResult, settingDest,
  search, categoryFilter, destFilter, marketFilter, categories, markets,
  selectedBoxIds, syncingFnskuBoxId, editingCell, printedBoxIds,
  mktCodeToName, donorMap,
  onSearchChange, onCategoryFilterChange, onDestFilterChange, onMarketFilterChange,
  onToggleExtraBox, onToggleBulkFba, onBulkFbaTextChange, onBulkFbaSubmit, onCloseBulkFba,
  onExportBoxes, onExportShipmate,
  onSelectAllBoxes, onToggleBoxSelect, onSetDestination,
  onCreateBox, onCloseExtraBox,
  onSyncFnsku, onCopyDimensions, onPrintBoxLabel, onDeleteBox,
  onEditingCellChange, onBoxUpdated,
}: Props) {
  const hasBoxes = boxes.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {isActive && canBoxes && (
          <button onClick={onToggleExtraBox} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Ek Koli
          </button>
        )}
        {canDest && hasBoxes && (
          <button onClick={onToggleBulkFba} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600">
            Toplu FBA İşaretle
          </button>
        )}
        {hasBoxes && (
          <button onClick={onExportBoxes} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 border">
            <Download className="w-4 h-4" /> Excel Koli Listesi
          </button>
        )}
        {canEdit && hasBoxes && (
          <button onClick={onExportShipmate} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
            <Download className="w-4 h-4" /> Shipmate İndir
          </button>
        )}
        {hasBoxes && (
          <>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" value={search} onChange={e => onSearchChange(e.target.value)}
                placeholder="Koli no, SKU, ürün..."
                className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              {search && (
                <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {categories.length > 1 && (
              <select value={categoryFilter} onChange={e => onCategoryFilterChange(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                <option value="">Tüm Kategoriler</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select value={destFilter} onChange={e => onDestFilterChange(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
              <option value="">Tüm Hedefler</option>
              <option value="FBA">FBA</option>
              <option value="DEPO">Depo</option>
            </select>
            {markets.length > 1 && (
              <select value={marketFilter} onChange={e => onMarketFilterChange(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
                <option value="">Tüm Pazarlar</option>
                {markets.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </>
        )}
        {canDest && selectedBoxIds.size > 0 && (
          <>
            <button onClick={() => onSetDestination('FBA')} disabled={settingDest}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50">
              {settingDest ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {selectedBoxIds.size} koli → FBA
            </button>
            <button onClick={() => onSetDestination('DEPO')} disabled={settingDest}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
              {selectedBoxIds.size} koli → Depo
            </button>
            <button onClick={() => onSetDestination('SHOWROOM')} disabled={settingDest}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50">
              {selectedBoxIds.size} koli → Fairfield
            </button>
          </>
        )}
      </div>

      {showExtraBox && (
        <ExtraBoxForm
          onSubmit={async (form) => { const r = await onCreateBox(form, null); if (r) onCloseExtraBox(); }}
          onCancel={onCloseExtraBox}
        />
      )}
      {showBulkFba && (
        <BulkFbaPanel
          text={bulkFbaText}
          saving={settingDest}
          result={bulkFbaResult}
          onTextChange={onBulkFbaTextChange}
          onSubmit={onBulkFbaSubmit}
          onClose={onCloseBulkFba}
        />
      )}

      <div className="bg-white border rounded-xl overflow-hidden">
        {hasBoxes ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="w-10 px-3 py-3">
                  <button onClick={onSelectAllBoxes} className="text-gray-600 hover:text-purple-600">
                    {selectedBoxIds.size === boxes.length && hasBoxes
                      ? <CheckSquare className="w-5 h-5" />
                      : <Square className="w-5 h-5" />}
                  </button>
                </th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Koli No</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Hedef</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Adet</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">En</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Boy</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Yuk.</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Agr.</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Desi</th>
                <th className="w-8"></th>
                <th className="w-10"></th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredBoxes.map(box => {
                const boxDesi = (box.width && box.depth && box.height) ? (box.width * box.depth * box.height / 5000) : null;
                const isFba = box.destination === 'FBA';
                const donorKey = `${box.iwasku}|${box.quantity}`;
                const donor = donorMap.get(donorKey);
                const needsCopy = donor && donor.id !== box.id && (!box.width || !box.depth || !box.height || !box.weight);

                return (
                  <tr key={box.id} className={`hover:bg-gray-50 ${isFba ? 'bg-orange-50/40' : ''}`}>
                    <td className="px-3 py-3 text-center">
                      <button onClick={() => onToggleBoxSelect(box.id)} className="hover:scale-110 transition-transform">
                        {selectedBoxIds.has(box.id)
                          ? <CheckSquare className="w-5 h-5 text-purple-600" />
                          : <Square className="w-5 h-5 text-gray-300" />}
                      </button>
                    </td>
                    <td className="px-3 py-3 font-mono text-sm font-semibold text-gray-900">{box.boxNumber}</td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${isFba ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                        {isFba ? 'FBA' : 'Depo'}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-sm text-gray-700">{box.iwasku || '—'}</td>
                    <td className="px-3 py-3 font-mono text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        {box.fnsku || '—'}
                        {canBoxes && box.fnsku && (
                          <button
                            onClick={() => onSyncFnsku(box.id)}
                            disabled={syncingFnskuBoxId === box.id}
                            className="text-gray-300 hover:text-blue-500 transition-colors"
                            title="FNSKU güncelle (sku_master'dan)">
                            <RefreshCw className={`w-3 h-3 ${syncingFnskuBoxId === box.id ? 'animate-spin text-blue-500' : ''}`} />
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-700 line-clamp-1">{box.productName || '—'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{(box.marketplaceCode && mktCodeToName.get(box.marketplaceCode)) || box.marketplaceCode || '—'}</td>
                    <td className="text-center px-3 py-3 font-semibold">{box.quantity}</td>
                    <EditableBoxCell boxId={box.id} shipmentId={shipmentId} field="width" value={box.width} canEdit={isActive && canBoxes} onUpdated={onBoxUpdated}
                      editingCell={editingCell} setEditingCell={onEditingCellChange} visibleBoxes={filteredBoxes} />
                    <EditableBoxCell boxId={box.id} shipmentId={shipmentId} field="depth" value={box.depth} canEdit={isActive && canBoxes} onUpdated={onBoxUpdated}
                      editingCell={editingCell} setEditingCell={onEditingCellChange} visibleBoxes={filteredBoxes} />
                    <EditableBoxCell boxId={box.id} shipmentId={shipmentId} field="height" value={box.height} canEdit={isActive && canBoxes} onUpdated={onBoxUpdated}
                      editingCell={editingCell} setEditingCell={onEditingCellChange} visibleBoxes={filteredBoxes} />
                    <EditableBoxCell boxId={box.id} shipmentId={shipmentId} field="weight" value={box.weight} canEdit={isActive && canBoxes} onUpdated={onBoxUpdated}
                      editingCell={editingCell} setEditingCell={onEditingCellChange} visibleBoxes={filteredBoxes} />
                    <td className="text-center px-3 py-3 font-medium text-gray-900">{boxDesi ? boxDesi.toFixed(1) : '—'}</td>
                    <td className="px-1 py-3 text-center">
                      {isActive && canBoxes && needsCopy ? (
                        <button onClick={() => onCopyDimensions(box, donor)}
                          className="text-blue-400 hover:text-blue-600 transition-colors"
                          title={`Ölçüleri kopyala (${donor.width}×${donor.depth}×${donor.height}, ${donor.weight}kg)`}>
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <button onClick={() => onPrintBoxLabel(box)}
                        className={`transition-colors ${printedBoxIds.has(box.id) ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-blue-600'}`}
                        title={printedBoxIds.has(box.id) ? 'Basıldı — tekrar bas' : 'Etiket bas'}>
                        <Printer className="w-4 h-4" />
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      {isActive && canBoxes && (
                        <button onClick={() => onDeleteBox(box.id)} className="text-red-400 hover:text-red-600">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-12">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Henüz koli eklenmedi</p>
          </div>
        )}
      </div>
    </div>
  );
}
