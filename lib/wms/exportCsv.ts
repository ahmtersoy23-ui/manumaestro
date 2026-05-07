/**
 * CSV indirme yardımcısı — string array → CSV → Blob → download.
 * Excel UTF-8 BOM eklenir (Türkçe karakterler doğru gösterilsin).
 */

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(headers: string[], rows: (string | number | null)[][]): string {
  const headerLine = headers.map(escapeCell).join(',');
  const bodyLines = rows.map((r) => r.map(escapeCell).join(','));
  return [headerLine, ...bodyLines].join('\n');
}

export function downloadCsv(csv: string, filename: string): void {
  // BOM (﻿) → Excel'de Türkçe doğru
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
