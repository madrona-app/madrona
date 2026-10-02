import { describe, it, expect } from 'vitest';
import type { LucideIcon } from 'lucide-react';

import type { SectionGroup } from '@/components/record-detail/SectionNav';
import { resolveLayout, layoutView, type FormLayoutDelta } from './resolveLayout';

// Minimal icon stub — the resolver never touches it.
const Icon = (() => null) as unknown as LucideIcon;

function baseLayout(): SectionGroup[] {
  return [
    {
      id: 'overview',
      label: 'Overview',
      icon: Icon,
      defaultExpanded: true,
      sections: [
        { id: 'media', label: 'Media', dataKey: 'media' },
        // Required: identification has requiredFields.
        {
          id: 'identification',
          label: 'Identification',
          dataKey: 'identification',
          requiredFields: ['object_number'],
        },
      ],
    },
    {
      id: 'details',
      label: 'Details',
      icon: Icon,
      defaultExpanded: true,
      sections: [
        { id: 'description', label: 'Description', dataKey: 'description' },
        { id: 'subjects', label: 'Subjects', dataKey: 'subjects' },
      ],
    },
    {
      id: 'care',
      label: 'Care',
      icon: Icon,
      defaultExpanded: false,
      sections: [{ id: 'rights', label: 'Rights', dataKey: 'rights' }],
    },
  ];
}

const ids = (groups: SectionGroup[]) =>
  groups.map((g) => ({ g: g.id, s: g.sections.map((s) => s.id) }));

describe('resolveLayout', () => {
  it('returns the base unchanged when there is no delta', () => {
    const base = baseLayout();
    expect(resolveLayout(base, null)).toBe(base);
    expect(resolveLayout(base, undefined)).toBe(base);
  });

  it('hides a non-required section', () => {
    const out = resolveLayout(baseLayout(), { hidden_sections: ['media'] });
    expect(out[0].sections.map((s) => s.id)).toEqual(['identification']);
  });

  it('never hides a required section (compliance)', () => {
    const out = resolveLayout(baseLayout(), {
      hidden_sections: ['identification', 'media'],
    });
    // media gone, identification (required) survives.
    expect(out[0].sections.map((s) => s.id)).toEqual(['identification']);
  });

  it('drops a group emptied by hiding, but keeps groups with a required section', () => {
    const out = resolveLayout(baseLayout(), {
      hidden_sections: ['rights', 'media', 'identification'],
    });
    const gids = out.map((g) => g.id);
    expect(gids).not.toContain('care'); // rights hidden → care empty → dropped
    expect(gids).toContain('overview'); // identification required → kept
  });

  it('reorders sections within a group; unlisted keep base order after', () => {
    const out = resolveLayout(baseLayout(), {
      section_order: ['subjects'],
    });
    const details = out.find((g) => g.id === 'details')!;
    expect(details.sections.map((s) => s.id)).toEqual([
      'subjects',
      'description',
    ]);
  });

  it('reorders groups; unlisted keep base order after', () => {
    const out = resolveLayout(baseLayout(), { group_order: ['care', 'details'] });
    expect(out.map((g) => g.id)).toEqual(['care', 'details', 'overview']);
  });

  it('collapses listed groups via defaultExpanded override', () => {
    const out = resolveLayout(baseLayout(), { collapsed_groups: ['overview'] });
    expect(out.find((g) => g.id === 'overview')!.defaultExpanded).toBe(false);
    expect(out.find((g) => g.id === 'details')!.defaultExpanded).toBe(true);
  });

  it('ignores unknown ids (schema drift)', () => {
    const delta: FormLayoutDelta = {
      hidden_sections: ['ghost'],
      section_order: ['ghost'],
      group_order: ['ghost'],
      collapsed_groups: ['ghost'],
    };
    expect(ids(resolveLayout(baseLayout(), delta))).toEqual(ids(baseLayout()));
  });

  it('does not mutate the base', () => {
    const base = baseLayout();
    const snapshot = JSON.stringify(ids(base));
    resolveLayout(base, {
      hidden_sections: ['media'],
      group_order: ['care'],
      collapsed_groups: ['overview'],
    });
    expect(JSON.stringify(ids(base))).toEqual(snapshot);
    expect(base[0].defaultExpanded).toBe(true); // unchanged
  });
});

describe('layoutView', () => {
  it('no delta → base groups and nothing hidden', () => {
    const v = layoutView(baseLayout(), null);
    expect(ids(v.groups)).toEqual(ids(baseLayout()));
    expect(v.isHidden('media')).toBe(false);
    expect(v.isHidden('rights')).toBe(false);
  });

  it('isHidden true for a hidden non-required section', () => {
    const v = layoutView(baseLayout(), { hidden_sections: ['media'] });
    expect(v.isHidden('media')).toBe(true);
    expect(v.isHidden('description')).toBe(false);
  });

  it('isHidden false for a required section even if the delta lists it', () => {
    const v = layoutView(baseLayout(), { hidden_sections: ['identification'] });
    expect(v.isHidden('identification')).toBe(false);
  });

  it('isHidden false for unknown ids', () => {
    const v = layoutView(baseLayout(), { hidden_sections: ['ghost'] });
    expect(v.isHidden('ghost')).toBe(false);
  });
});
