/**
 * Üretim etiketi yazdırma popup'ı (100×30 mm).
 *
 * Layout: Sol 26×26mm QR (içerik = full barcode) + Sağda ürün adı (12pt bold,
 * auto-shrink 6pt'a kadar) + iwasku-serial (8pt monospace).
 *
 * QR kodları popup'tan ÖNCE parent'ta `qrcode` npm paketi ile data URL olarak
 * üretilip inline geçilir — CDN/network bağımlılığı yok, CSP kısıtlarından
 * etkilenmez, popup tamamen self-contained.
 */

interface SerialEntry {
  fullBarcode: string;
  qrDataUrl: string; // data:image/png;base64,...
}

interface OpenProductLabelPopupArgs {
  productName: string;
  iwasku: string;
  entries: SerialEntry[];
}

export function openProductLabelPopup({ productName, iwasku, entries }: OpenProductLabelPopupArgs): void {
  if (entries.length === 0) return;

  const printWindow = window.open('', '_blank', 'width=700,height=900');
  if (!printWindow) {
    alert('Popup engellendi. Lütfen tarayıcıda popup\'a izin verin.');
    return;
  }

  const safeProductName = escapeHtml(productName);
  const safeIwasku = escapeHtml(iwasku);

  const labelsHtml = entries
    .map(
      (e) => `
    <div class="label">
      <div class="qr-box"><img src="${e.qrDataUrl}" alt="QR" /></div>
      <div class="text-area">
        <div class="product-name">${safeProductName}</div>
        <div class="iwasku-serial">${escapeHtml(e.fullBarcode)}</div>
      </div>
    </div>`
    )
    .join('');

  printWindow.document.write(`<!DOCTYPE html>
<html>
  <head>
    <title>Etiket Yazdir — ${safeIwasku}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
      .controls { background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px; text-align: center; }
      .controls h2 { margin-bottom: 8px; color: #2563eb; font-size: 16px; }
      .btn { padding: 12px 24px; margin: 4px; cursor: pointer; font-size: 15px; border: none; border-radius: 6px; font-weight: 600; }
      .btn-print { background: #2563eb; color: white; }
      .btn-close { background: #6b7280; color: white; }
      .labels-container { display: flex; flex-direction: column; gap: 8px; padding: 16px; background: white; border-radius: 8px; }
      .label {
        width: 100mm; height: 30mm;
        border: 1px dashed #bbb;
        padding: 1.5mm 2mm 1.5mm 1.5mm;
        gap: 2mm;
        background: white;
        display: flex; align-items: center;
        page-break-inside: avoid; overflow: hidden;
      }
      .qr-box { width: 26mm; height: 26mm; flex-shrink: 0; }
      .qr-box img { width: 100% !important; height: 100% !important; display: block; }
      .text-area {
        flex: 1; min-width: 0; height: 100%;
        display: flex; flex-direction: column; justify-content: center;
        gap: 1mm; overflow: hidden;
      }
      .product-name {
        font-size: 12pt; font-weight: 700; line-height: 1.2;
        word-break: break-word; overflow-wrap: anywhere;
      }
      .iwasku-serial {
        font-size: 8pt; font-family: 'Courier New', monospace;
        letter-spacing: 0.3px; color: #333; flex-shrink: 0;
      }
      @media print {
        body { padding: 0; background: white; }
        .controls { display: none !important; }
        .labels-container { padding: 0; background: transparent; gap: 0; }
        .label { border: none; page-break-after: always; }
        .label:last-child { page-break-after: auto; }
        @page { size: 100mm 30mm; margin: 0; }
      }
    </style>
  </head>
  <body>
    <div class="controls">
      <h2>${entries.length} Etiket — ${safeIwasku}</h2>
      <button class="btn btn-print" onclick="window.print()">Yazdir</button>
      <button class="btn btn-close" onclick="window.close()">Kapat</button>
    </div>
    <div class="labels-container">${labelsHtml}</div>
    <script>
      // Auto-shrink: ürün adını text-area'ya sığana kadar küçült (12pt → 6pt)
      function fitText(nameEl) {
        var textArea = nameEl.parentElement;
        if (!textArea) return;
        var current = 12;
        nameEl.style.fontSize = current + 'pt';
        while (textArea.scrollHeight > textArea.clientHeight + 0.5 && current > 6) {
          current = Math.max(6, current - 0.25);
          nameEl.style.fontSize = current + 'pt';
        }
      }
      // Tüm img'ler yüklenince fit et (QR yüklendikçe layout sabitlensin)
      window.addEventListener('load', function() {
        document.querySelectorAll('.product-name').forEach(fitText);
      });
    </script>
  </body>
</html>`);
  printWindow.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
