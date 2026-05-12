/**
 * Shipment detail page'deki modal/panel toggle state'leri.
 *
 * Boolean-only state'leri tek hook'ta toplar. Flat shape — kullanım yerleri
 * isim değiştirmez.
 */

import { useState } from 'react';

export function useModalToggles() {
  const [showAddItem, setShowAddItem] = useState(false);
  const [showExtraBox, setShowExtraBox] = useState(false);
  const [showBulkFba, setShowBulkFba] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showSPExport, setShowSPExport] = useState(false);
  const [editing, setEditing] = useState(false);

  return {
    showAddItem, setShowAddItem,
    showExtraBox, setShowExtraBox,
    showBulkFba, setShowBulkFba,
    showExitModal, setShowExitModal,
    showSPExport, setShowSPExport,
    editing, setEditing,
  };
}
