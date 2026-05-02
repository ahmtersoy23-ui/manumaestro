/**
 * Üretim etiketi yazdırma popup'ı (100×30 mm).
 *
 * Layout: Sol 26×26mm QR (içerik = full barcode) + Sağda ürün adı (12pt bold,
 * auto-shrink 6pt'a kadar) + iwasku-serial (8pt monospace).
 *
 * SwiftStock'taki Products.tsx ile birebir aynı tasarım — kullanıcı QR ve text'in
 * görünüm/okuma kalitesini orada onayladı, aynısını burada üretiyoruz.
 *
 * Kütüphane: qrcodejs CDN (popup içine yüklenir, bundle'a girmez).
 */

interface OpenProductLabelPopupArgs {
  productName: string;
  serials: string[]; // [{full_barcode}] formatında IWASKU-XXXXXX dizisi
  iwasku: string;
}

export function openProductLabelPopup({ productName, serials, iwasku }: OpenProductLabelPopupArgs): void {
  if (serials.length === 0) return;

  const printWindow = window.open('', '_blank', 'width=700,height=900');
  if (!printWindow) {
    alert('Popup engellendi. Lütfen tarayıcıda popup\'a izin verin.');
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html>
  <head>
    <title>Etiket Yazdir — ${escapeHtml(iwasku)}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
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
      .qr-box img, .qr-box canvas { width: 100% !important; height: 100% !important; display: block; }
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
      <h2 id="title-text"></h2>
      <button class="btn btn-print" onclick="window.print()">Yazdir</button>
      <button class="btn btn-close" onclick="window.close()">Kapat</button>
    </div>
    <div class="labels-container" id="labels-container"></div>
  </body>
</html>`);
  printWindow.document.close();

  type QRCodeCtor = new (
    el: Element,
    opts: { text: string; width: number; height: number; colorDark: string; colorLight: string; correctLevel: number }
  ) => unknown;

  const render = () => {
    const win = printWindow as Window & { QRCode: QRCodeCtor };

    const titleEl = printWindow.document.getElementById('title-text');
    if (titleEl) titleEl.textContent = `${serials.length} Etiket — ${iwasku}`;

    const container = printWindow.document.getElementById('labels-container');
    if (!container) return;

    const fitText = (nameEl: HTMLElement) => {
      const textArea = nameEl.parentElement;
      if (!textArea) return;
      const maxFont = 12;
      const minFont = 6;
      const step = 0.25;
      let current = maxFont;
      nameEl.style.fontSize = current + 'pt';
      while (textArea.scrollHeight > textArea.clientHeight + 0.5 && current > minFont) {
        current = Math.max(minFont, current - step);
        nameEl.style.fontSize = current + 'pt';
      }
    };

    serials.forEach((fullBarcode) => {
      const label = printWindow.document.createElement('div');
      label.className = 'label';

      const qrBox = printWindow.document.createElement('div');
      qrBox.className = 'qr-box';
      label.appendChild(qrBox);

      const textArea = printWindow.document.createElement('div');
      textArea.className = 'text-area';

      const nameDiv = printWindow.document.createElement('div');
      nameDiv.className = 'product-name';
      nameDiv.textContent = productName;
      textArea.appendChild(nameDiv);

      const serialDiv = printWindow.document.createElement('div');
      serialDiv.className = 'iwasku-serial';
      serialDiv.textContent = fullBarcode;
      textArea.appendChild(serialDiv);

      label.appendChild(textArea);
      container.appendChild(label);

      try {
        new win.QRCode(qrBox, {
          text: fullBarcode,
          width: 98,
          height: 98,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: 1, // M (medium error correction)
        });
      } catch {
        /* skip */
      }

      fitText(nameDiv);
    });
  };

  if ((printWindow as unknown as { QRCode?: unknown }).QRCode) {
    render();
  } else {
    printWindow.addEventListener('load', render);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
