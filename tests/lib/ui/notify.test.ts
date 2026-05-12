import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-hot-toast', () => {
  const toast = vi.fn() as unknown as {
    (msg: string, opts?: object): string;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    loading: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    promise: ReturnType<typeof vi.fn>;
  };
  toast.success = vi.fn();
  toast.error = vi.fn();
  toast.loading = vi.fn(() => 'tid-1');
  toast.dismiss = vi.fn();
  toast.promise = vi.fn();
  return { toast };
});

import { notify } from '@/lib/ui/notify';
import { toast } from 'react-hot-toast';

const mt = toast as unknown as {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  loading: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
  promise: ReturnType<typeof vi.fn>;
};

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('success → toast.success', () => {
    notify.success('Kaydedildi');
    expect(mt.success).toHaveBeenCalledWith('Kaydedildi');
  });

  it('error → toast.error', () => {
    notify.error('Hata oluştu');
    expect(mt.error).toHaveBeenCalledWith('Hata oluştu');
  });

  it('error error parametresi varsa mesaja Error.message ekler', () => {
    notify.error('Sevkiyat olusturulamadi', new Error('SKU bulunamadi'));
    expect(mt.error).toHaveBeenCalledWith('Sevkiyat olusturulamadi: SKU bulunamadi');
  });

  it('error error string ise mesaja ekler', () => {
    notify.error('Hata', 'detail');
    expect(mt.error).toHaveBeenCalledWith('Hata: detail');
  });

  it('error error mesaj ile aynıysa duplicate eklemez', () => {
    notify.error('aynı', new Error('aynı'));
    expect(mt.error).toHaveBeenCalledWith('aynı');
  });

  it('error error undefined ise sade mesaj', () => {
    notify.error('Hata');
    expect(mt.error).toHaveBeenCalledWith('Hata');
  });

  it('info → toast()', () => {
    notify.info('bilgilendirme');
    expect(toast).toHaveBeenCalledWith('bilgilendirme');
  });

  it('warn → toast() icon ile', () => {
    notify.warn('dikkat');
    expect(toast).toHaveBeenCalledWith('dikkat', { icon: '⚠️' });
  });

  it('loading toast id döndürür', () => {
    const id = notify.loading('Yükleniyor');
    expect(id).toBe('tid-1');
    expect(mt.loading).toHaveBeenCalledWith('Yükleniyor');
  });

  it('dismiss id ile toast.dismiss çağırır', () => {
    notify.dismiss('tid-1');
    expect(mt.dismiss).toHaveBeenCalledWith('tid-1');
  });

  it('promise messages forward edilir', async () => {
    const p = Promise.resolve('ok');
    mt.promise.mockReturnValue(p);
    notify.promise(p, { loading: 'L', success: 'S', error: 'E' });
    expect(mt.promise).toHaveBeenCalledWith(p, { loading: 'L', success: 'S', error: 'E' });
  });
});
