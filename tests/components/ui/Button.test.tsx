import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/Button';

// İlk component testi — testing-library zaten kurulu, bu pattern'i açar.
describe('Button', () => {
  it('children render eder, varsayılan primary mavi', () => {
    render(<Button>Kaydet</Button>);
    const btn = screen.getByRole('button', { name: 'Kaydet' });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain('bg-blue-600');
  });

  it('variant=danger kırmızı uygular', () => {
    render(<Button variant="danger">Sil</Button>);
    expect(screen.getByRole('button', { name: 'Sil' }).className).toContain('bg-red-600');
  });

  it('loading: spinner gösterir ve butonu disable eder', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Kaydet</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn.querySelector('svg')).not.toBeNull(); // Loader2 spinner
  });

  it('tıklama onClick tetikler', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Tıkla</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Tıkla' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled iken tıklama onClick tetiklemez', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Tıkla</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Tıkla' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
