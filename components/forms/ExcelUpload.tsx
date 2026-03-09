/**
 * Excel Upload Component
 * For bulk uploading production requests via Excel
 */

'use client';

import { useState, useEffect } from 'react';
import { Upload, Download, FileSpreadsheet, X, Calendar, AlertCircle, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getAvailableMonthsForEntry, formatMonthDisplay, getCurrentMonth } from '@/lib/monthUtils';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ExcelUpload');

interface ExcelUploadProps {
  marketplaceId: string;
  marketplaceName: string;
}

interface ParsedRow {
  iwasku: string;
  quantity: number;
  notes?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
}

const PRIORITY_MAP: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'> = {
  'yüksek': 'HIGH', 'yuksek': 'HIGH', 'high': 'HIGH', 'h': 'HIGH',
  'orta': 'MEDIUM', 'medium': 'MEDIUM', 'm': 'MEDIUM',
  'düşük': 'LOW', 'dusuk': 'LOW', 'low': 'LOW', 'l': 'LOW',
};

export function ExcelUpload({ marketplaceId, marketplaceName }: ExcelUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [productionMonth, setProductionMonth] = useState('');
  const [monthError, setMonthError] = useState('');
  const [success, setSuccess] = useState(false);

  const availableMonths = getAvailableMonthsForEntry();

  // Auto-select first available month on mount
  useEffect(() => {
    if (!productionMonth && availableMonths.length > 0) {
      setProductionMonth(availableMonths[0].value);
    }
  }, [availableMonths]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const parseExcel = async (file: File): Promise<ParsedRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

          // Skip header row, parse data
          const rows: ParsedRow[] = [];
          for (let i = 1; i < jsonData.length && i <= 1000; i++) {
            const row = jsonData[i];
            if (row && row[0] && row[1]) {
              const rawPriority = row[3] ? String(row[3]).trim().toLowerCase() : '';
              rows.push({
                iwasku: String(row[0]).trim(),
                quantity: parseInt(String(row[1])),
                notes: row[2] ? String(row[2]).trim() : undefined,
                priority: PRIORITY_MAP[rawPriority] ?? 'MEDIUM',
              });
            }
          }

          resolve(rows);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Dosya okunamadı'));
      reader.readAsBinaryString(file);
    });
  };

  const handleUpload = async () => {
    if (!file) return;

    setMonthError('');
    setUploading(true);
    setSuccess(false);

    try {
      // Parse Excel file
      const rows = await parseExcel(file);

      if (rows.length === 0) {
        alert('Excel dosyasında geçerli veri bulunamadı');
        setUploading(false);
        return;
      }

      // Send to bulk upload API
      const res = await fetch('/api/requests/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          marketplaceId,
          productionMonth,
          requests: rows,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        setFile(null);

        // Hide success message after 3 seconds
        setTimeout(() => setSuccess(false), 3000);
      } else {
        alert(data.error || 'Talepler yüklenemedi');
      }
    } catch (error) {
      logger.error('Upload error:', error);
      alert('Excel dosyası işlenemedi');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    // Create template workbook
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['IWASKU', 'Miktar', 'Notlar', 'Öncelik'],
      ['IM154@0QXFF0', '100', 'İsteğe bağlı not', 'Yüksek'],
      ['CA120@0R53ZY', '50', '', 'Orta'],
      ['EX789@0AB12C', '200', '', 'Düşük'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `${marketplaceName}_template.xlsx`);
  };

  return (
    <div className="space-y-6">
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <Check className="w-5 h-5 text-green-600" />
          <p className="text-sm font-medium text-green-900">
            Talepler başarıyla yüklendi!
          </p>
        </div>
      )}

      {/* Month Selection Error */}
      {monthError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-sm font-medium text-red-900">{monthError}</p>
        </div>
      )}

      {/* Production Month Selector */}
      <div>
        <label htmlFor="productionMonth" className="block text-sm font-medium text-gray-700 mb-2">
          Üretim Ayı *
        </label>
        <div className="relative">
          <select
            id="productionMonth"
            value={productionMonth}
            onChange={(e) => {
              setProductionMonth(e.target.value);
              setMonthError('');
            }}
            className="w-full px-4 py-2 pl-10 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-400 transition-all appearance-none bg-white cursor-pointer text-gray-900"
            required
          >
            {availableMonths.map((month) => (
              <option
                key={month.value}
                value={month.value}
                className="text-gray-900"
              >
                {month.label}
              </option>
            ))}
          </select>
          <Calendar className="absolute left-3 top-2.5 w-5 h-5 text-gray-400 pointer-events-none" />
          <div className="absolute right-3 top-2.5 pointer-events-none">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Download Template */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-900 mb-1">
              Excel Şablonu İndir
            </h4>
            <p className="text-sm text-blue-700 mb-3">
              Doğru format için şablonumuzu kullanın. Zorunlu sütunlar: IWASKU, Miktar. Öncelik her satır için D sütununa yazılır.
            </p>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              Şablonu İndir
            </button>
          </div>
        </div>
      </div>

      {/* Upload Area */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 hover:border-purple-400 transition-colors">
        <div className="flex flex-col items-center justify-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Upload className="w-8 h-8 text-gray-400" />
          </div>

          {!file ? (
            <>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Excel Dosyası Yükle
              </h3>
              <p className="text-sm text-gray-600 mb-4 text-center">
                Excel dosyanızı buraya sürükleyin veya dosya seçin
              </p>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <span className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors">
                  Dosya Seç
                </span>
              </label>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <FileSpreadsheet className="w-8 h-8 text-green-600" />
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(2)} KB
                  </p>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="ml-2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={handleUpload}
                disabled={uploading || !productionMonth}
                className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-green-600 to-green-700 rounded-lg hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Yükleniyor...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Dosyayı Yükle
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">
          Excel Format Talimatları
        </h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Sütun A: IWASKU (Zorunlu)</li>
          <li>• Sütun B: Miktar (Zorunlu, sayı olmalı)</li>
          <li>• Sütun C: Notlar (İsteğe bağlı)</li>
          <li>• Sütun D: Öncelik (İsteğe bağlı — Yüksek / Orta / Düşük, boş bırakılırsa Orta)</li>
          <li>• İlk satır başlık içermelidir</li>
          <li>• Yükleme başına en fazla 1000 satır</li>
        </ul>
      </div>
    </div>
  );
}
