/**
 * Excel Upload Component
 * For bulk uploading production requests via Excel
 */

'use client';

import { useState } from 'react';
import { Upload, Download, FileSpreadsheet, X } from 'lucide-react';

interface ExcelUploadProps {
  marketplaceId: string;
  marketplaceName: string;
}

export function ExcelUpload({ marketplaceId, marketplaceName }: ExcelUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);

    // TODO: Parse Excel and send to API
    console.log('Uploading file:', file.name);

    setTimeout(() => {
      setUploading(false);
      setFile(null);
      alert('Upload successful!');
    }, 2000);
  };

  const downloadTemplate = () => {
    // TODO: Generate and download Excel template
    console.log('Downloading template for:', marketplaceName);
  };

  return (
    <div className="space-y-6">
      {/* Download Template */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-900 mb-1">
              Download Excel Template
            </h4>
            <p className="text-sm text-blue-700 mb-3">
              Use our template to ensure correct formatting. Required columns: IWASKU, Quantity
            </p>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Template
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
                Upload Excel File
              </h3>
              <p className="text-sm text-gray-600 mb-4 text-center">
                Drop your Excel file here or click to browse
              </p>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <span className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors">
                  Select File
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
                disabled={uploading}
                className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-green-600 to-green-700 rounded-lg hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload File
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
          Excel Format Instructions
        </h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Column A: IWASKU (Required)</li>
          <li>• Column B: Quantity (Required, must be a number)</li>
          <li>• Column C: Notes (Optional)</li>
          <li>• First row should contain headers</li>
          <li>• Maximum 1000 rows per upload</li>
        </ul>
      </div>
    </div>
  );
}
