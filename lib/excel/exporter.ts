/**
 * Excel Export Utility
 * Memory-efficient Excel export using streaming with ExcelJS
 */

import ExcelJS from 'exceljs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Excel Exporter');

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
  style?: Partial<ExcelJS.Style>;
}

export interface ExportOptions {
  sheetName: string;
  columns: ExportColumn[];
  fileName: string;
  title?: string;
  author?: string;
}

/**
 * Create Excel workbook with data
 * Memory-efficient streaming approach
 */
export async function createExcelWorkbook<T extends Record<string, any>>(
  data: T[],
  options: ExportOptions
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();

  // Set workbook metadata
  workbook.creator = options.author || 'ManuMaestro';
  workbook.lastModifiedBy = options.author || 'ManuMaestro';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Create worksheet
  const worksheet = workbook.addWorksheet(options.sheetName, {
    properties: { tabColor: { argb: '9C27B0' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }], // Freeze header row
  });

  // Configure columns
  worksheet.columns = options.columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || 15,
    style: col.style || {},
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF6B21A8' }, // Purple gradient
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add title if provided
  if (options.title) {
    worksheet.insertRow(1, [options.title]);
    const titleRow = worksheet.getRow(1);
    titleRow.font = { bold: true, size: 14, color: { argb: 'FF6B21A8' } };
    titleRow.alignment = { horizontal: 'center' };
    titleRow.height = 30;

    // Merge title across all columns
    worksheet.mergeCells(1, 1, 1, options.columns.length);

    // Move header to row 2
    worksheet.spliceRows(2, 0, [options.columns.map((c) => c.header)]);
  }

  // Add data rows in batches (memory-efficient)
  const BATCH_SIZE = 1000;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    batch.forEach((row) => {
      const excelRow = worksheet.addRow(row);

      // Apply zebra striping
      if (excelRow.number % 2 === 0) {
        excelRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF5F5F5' }, // Light gray
        };
      }

      // Style all cells
      excelRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        };
        cell.alignment = { vertical: 'middle' };
      });
    });

    // Log progress for large datasets
    if (data.length > 5000 && (i + BATCH_SIZE) % 5000 === 0) {
      logger.debug(`Processed ${i + BATCH_SIZE} / ${data.length} rows`);
    }
  }

  // Auto-filter on header row
  const headerRowNumber = options.title ? 2 : 1;
  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: options.columns.length },
  };

  return workbook;
}

/**
 * Export data to Excel buffer
 */
export async function exportToExcel<T extends Record<string, any>>(
  data: T[],
  options: ExportOptions
): Promise<Buffer> {
  try {
    logger.info(`Starting Excel export: ${options.fileName} (${data.length} rows)`);

    const workbook = await createExcelWorkbook(data, options);

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    logger.info(`Excel export completed: ${options.fileName} (${buffer.byteLength} bytes)`);

    return Buffer.from(buffer);
  } catch (error) {
    logger.error('Excel export failed:', error);
    throw error;
  }
}

/**
 * Helper function to format date for Excel
 */
export function formatDateForExcel(date: Date | string | null | undefined): string {
  if (!date) return '';

  const d = typeof date === 'string' ? new Date(date) : date;

  if (isNaN(d.getTime())) return '';

  return d.toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Helper function to format status for Excel
 */
export function formatStatusForExcel(
  status: 'REQUESTED' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED'
): string {
  const statusMap = {
    REQUESTED: 'Talep Edildi',
    IN_PRODUCTION: 'Üretimde',
    COMPLETED: 'Tamamlandı',
    CANCELLED: 'İptal',
  };

  return statusMap[status] || status;
}
