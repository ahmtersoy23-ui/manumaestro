/**
 * Etiket dosyası storage helper.
 * Lokal disk: {LABEL_UPLOAD_ROOT}/{outboundOrderId}/{labelId}.{ext}
 * Production'da PM2 restart silmez (volume olarak korunur).
 */

import { mkdir, writeFile, unlink, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';

const UPLOAD_ROOT = process.env.LABEL_UPLOAD_ROOT || join(process.cwd(), 'uploads', 'labels');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);
const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
};

export interface SaveLabelInput {
  outboundOrderId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface SaveLabelResult {
  id: string;
  storagePath: string;
  fileSize: number;
}

export class LabelStorageError extends Error {
  constructor(public code: 'TOO_LARGE' | 'INVALID_MIME' | 'IO_ERROR', message: string) {
    super(message);
    this.name = 'LabelStorageError';
  }
}

export function validateLabelFile(mimeType: string, sizeBytes: number): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new LabelStorageError('INVALID_MIME', `Desteklenmeyen dosya tipi: ${mimeType}. PDF/PNG/JPG yükleyin.`);
  }
  if (sizeBytes > MAX_FILE_SIZE) {
    throw new LabelStorageError('TOO_LARGE', `Dosya 10MB'dan büyük (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
  }
}

export async function saveLabelFile(input: SaveLabelInput): Promise<SaveLabelResult> {
  validateLabelFile(input.mimeType, input.fileBuffer.length);

  const id = randomUUID();
  const ext = MIME_TO_EXT[input.mimeType] ?? extname(input.fileName) ?? '';
  const orderDir = join(UPLOAD_ROOT, input.outboundOrderId);
  const storagePath = join(orderDir, `${id}${ext}`);

  try {
    await mkdir(orderDir, { recursive: true });
    await writeFile(storagePath, input.fileBuffer);
  } catch (err) {
    throw new LabelStorageError('IO_ERROR', `Dosya kaydedilemedi: ${(err as Error).message}`);
  }

  return { id, storagePath, fileSize: input.fileBuffer.length };
}

export async function readLabelFile(storagePath: string): Promise<Buffer> {
  try {
    return await readFile(storagePath);
  } catch (err) {
    throw new LabelStorageError('IO_ERROR', `Dosya bulunamadı: ${(err as Error).message}`);
  }
}

export async function deleteLabelFile(storagePath: string): Promise<void> {
  try {
    await unlink(storagePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new LabelStorageError('IO_ERROR', `Dosya silinemedi: ${(err as Error).message}`);
    }
  }
}

export async function getLabelFileSize(storagePath: string): Promise<number | null> {
  try {
    const s = await stat(storagePath);
    return s.size;
  } catch {
    return null;
  }
}

export const LABEL_CONFIG = {
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES: Array.from(ALLOWED_MIME_TYPES),
  UPLOAD_ROOT,
} as const;
