import { describe, expect, it } from 'vitest';
import { pickerSections } from './groups';
import type { DesignEntry } from './types';

const entry = (id: string, name: string, extra: Partial<DesignEntry> = {}): DesignEntry => ({
  id,
  name,
  blurb: '',
  swatch: ['', '', '', ''],
  load: async () => {
    throw new Error('not loaded in this test');
  },
  ...extra,
});

describe('pickerSections', () => {
  it('lists the clarity designs, then Classic, then the earlier concepts, whatever the registry order', () => {
    const sections = pickerSections([
      entry('classic', 'Classic', { group: 'classic' }),
      entry('royal', 'Royal', { group: 'earlier' }),
      entry('glass', 'Glass', { group: 'clarity' }),
      entry('zen', 'Zen', { group: 'earlier' }),
      entry('ink', 'Ink', { group: 'clarity' }),
    ]);
    expect(sections.map((s) => s.entries.map((e) => e.id))).toEqual([
      ['glass', 'ink'],
      ['classic'],
      ['royal', 'zen'],
    ]);
    // Classic alone under "Classic" needs no heading
    expect(sections.map((s) => s.label)).toEqual(['Clarity', null, 'Earlier concepts']);
  });

  it('leaves hidden designs and empty groups out, and puts ungrouped ones last', () => {
    const sections = pickerSections([
      entry('kit-demo', 'Kit Demo', { group: 'clarity', hidden: true }),
      entry('loose', 'Loose'),
      entry('classic', 'Classic', { group: 'classic' }),
    ]);
    expect(sections.map((s) => s.entries.map((e) => e.id))).toEqual([['classic'], ['loose']]);
  });
});
