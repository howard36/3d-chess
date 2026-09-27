import type { DesignEntry, DesignGroup } from './types';

/** The picker's sections, in the order it shows them, with their headings. */
export const DESIGN_GROUPS: { id: DesignGroup; label: string }[] = [
  { id: 'clarity', label: 'Clarity' },
  { id: 'classic', label: 'Classic' },
  { id: 'earlier', label: 'Earlier concepts' },
];

export interface PickerSection {
  /** The heading, or null where one would only repeat its single entry's name. */
  label: string | null;
  entries: DesignEntry[];
}

/**
 * The picker's list: visible designs by group, in DESIGN_GROUPS order and
 * registry order within a group, then any ungrouped ones. Empty groups are
 * left out.
 */
export const pickerSections = (designs: DesignEntry[]): PickerSection[] => {
  const visible = designs.filter((d) => !d.hidden);
  const sections: PickerSection[] = DESIGN_GROUPS.map(({ id, label }) => {
    const entries = visible.filter((d) => d.group === id);
    return { label: entries.length === 1 && entries[0].name === label ? null : label, entries };
  });
  sections.push({ label: null, entries: visible.filter((d) => !d.group) });
  return sections.filter((s) => s.entries.length > 0);
};
