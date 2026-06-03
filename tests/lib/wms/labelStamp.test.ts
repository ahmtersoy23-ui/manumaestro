import { describe, expect, it } from 'vitest';
import { buildLabelCodes } from '@/lib/wms/labelStamp';

describe('buildLabelCodes — etiket kod satırı', () => {
  it('FNSKU varsa "iwasku (FNSKU)", yoksa sadece iwasku', () => {
    expect(
      buildLabelCodes([
        { iwasku: 'IM1830004T0D', fnsku: 'B0BS6HV9L5' },
        { iwasku: 'CA041C0GMFJ5', fnsku: null },
        { iwasku: 'DS0180080527' },
      ])
    ).toEqual(['IM1830004T0D (B0BS6HV9L5)', 'CA041C0GMFJ5', 'DS0180080527']);
  });

  it('boş liste → boş dizi', () => {
    expect(buildLabelCodes([])).toEqual([]);
  });
});
