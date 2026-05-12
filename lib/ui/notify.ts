/**
 * Toast bildirimleri — alert() yerine kullanılır.
 *
 * Kullanım:
 *   notify.success('Kaydedildi');
 *   notify.error('Sevkiyat oluşturulamadı', err);  // err.message otomatik append
 *   notify.info('İşlem başladı, 30 sn sürer');
 *   notify.warn('Stok azaldı');
 *
 * Native alert() blocking + a11y kötü + mobil UX yıkıcı; bunun yerine
 * react-hot-toast üzerinden non-blocking notification.
 *
 * Confirm dialog için: useConfirm() hook'unu kullan (lib/ui/useConfirm.ts).
 */
import { toast } from 'react-hot-toast';

function formatMessage(message: string, error?: unknown): string {
  if (!error) return message;
  const detail = error instanceof Error ? error.message : String(error);
  if (!detail || detail === message) return message;
  return `${message}: ${detail}`;
}

export const notify = {
  success(message: string) {
    toast.success(message);
  },
  error(message: string, error?: unknown) {
    toast.error(formatMessage(message, error));
  },
  info(message: string) {
    toast(message);
  },
  warn(message: string) {
    toast(message, { icon: '⚠️' });
  },
  loading(message: string) {
    return toast.loading(message);
  },
  dismiss(toastId?: string) {
    toast.dismiss(toastId);
  },
  /**
   * Promise tabanli — async iş sırasında loading, başarı/hata sonucu otomatik.
   */
  promise<T>(p: Promise<T>, msgs: { loading: string; success: string; error: string }) {
    return toast.promise(p, msgs);
  },
};
