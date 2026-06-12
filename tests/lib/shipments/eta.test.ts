import { describe, expect, it } from 'vitest';
import { seaEtaBadge } from '@/lib/shipments/eta';

const NOW = new Date('2026-06-10T08:00:00Z');
const iso = (d: string) => new Date(d + 'T00:00:00Z').toISOString();

describe('seaEtaBadge', () => {
  it('deniz dışı / teslim / etaDate yok → rozet yok', () => {
    expect(seaEtaBadge(iso('2026-06-11'), 'road', 'IN_TRANSIT', NOW)).toBeNull();
    expect(seaEtaBadge(iso('2026-06-11'), 'air', 'LOADING', NOW)).toBeNull();
    expect(seaEtaBadge(iso('2026-06-11'), 'sea', 'DELIVERED', NOW)).toBeNull();
    expect(seaEtaBadge(null, 'sea', 'IN_TRANSIT', NOW)).toBeNull();
  });

  it('ETA 3 günden uzak → rozet yok', () => {
    expect(seaEtaBadge(iso('2026-06-20'), 'sea', 'IN_TRANSIT', NOW)).toBeNull();
  });

  it('ETA ≤3 gün → amber', () => {
    expect(seaEtaBadge(iso('2026-06-13'), 'sea', 'IN_TRANSIT', NOW)).toMatchObject({ tone: 'amber', days: 3, text: 'Varışa 3 gün' });
    expect(seaEtaBadge(iso('2026-06-10'), 'sea', 'IN_TRANSIT', NOW)).toMatchObject({ tone: 'amber', days: 0, text: 'ETA bugün' });
  });

  it('ETA geçmiş → kırmızı', () => {
    expect(seaEtaBadge(iso('2026-06-07'), 'sea', 'IN_TRANSIT', NOW)).toMatchObject({ tone: 'red', days: -3, text: 'ETA 3 gün geçti' });
  });

  it('konteyner yöntemi de deniz gibi rozet alır', () => {
    expect(seaEtaBadge(iso('2026-06-13'), 'container', 'IN_TRANSIT', NOW)).toMatchObject({ tone: 'amber', days: 3 });
    expect(seaEtaBadge(iso('2026-06-11'), 'container', 'DELIVERED', NOW)).toBeNull();
  });
});
