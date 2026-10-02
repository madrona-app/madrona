/**
 * resolveLayout — apply a per-user layout override (delta) over a base layout.
 *
 * The base layout (PAGE_SECTION_GROUPS) and its required-field metadata live in
 * frontend constants, so the merge happens here rather than server-side. The
 * delta stores only overrides (hidden / reordered sections + groups, collapsed
 * groups) — never a full snapshot — so sections added to the base later surface
 * automatically.
 *
 * Invariants enforced here:
 *  - COMPLIANCE: a required section (isRequired, or with requiredFields) can
 *    never be hidden, regardless of the delta. (computeCompliance still runs on
 *    the full record elsewhere; this only protects the *view*.)
 *  - DRIFT: ids in the delta that no longer exist in the base are ignored.
 *  - PURITY: the base is never mutated; a new structure is returned.
 */
import type {
  SectionDefinition,
  SectionGroup,
} from '@/components/record-detail/SectionNav';

/**
 * Per-user overrides applied over the base layout. Mirrors the backend
 * `FormLayoutDelta` — ops only, never a snapshot, never markup.
 */
export interface FormLayoutDelta {
  hidden_sections?: string[];
  section_order?: string[];
  group_order?: string[];
  collapsed_groups?: string[];
}

const isRequiredSection = (s: SectionDefinition): boolean =>
  s.isRequired === true || (s.requiredFields?.length ?? 0) > 0;

/**
 * Sort key giving "explicit order first, then base order": ids listed in
 * `explicit` take their listed position; everything else keeps base order,
 * placed after all listed ids.
 */
const orderKey = (explicit: string[], id: string, baseIdx: number): number => {
  const i = explicit.indexOf(id);
  return i === -1 ? explicit.length + baseIdx : i;
};

export function resolveLayout(
  base: SectionGroup[],
  delta?: FormLayoutDelta | null
): SectionGroup[] {
  if (!delta) {
    return base;
  }

  const hidden = new Set(delta.hidden_sections ?? []);
  const collapsed = new Set(delta.collapsed_groups ?? []);
  const sectionOrder = delta.section_order ?? [];
  const groupOrder = delta.group_order ?? [];

  const groups = base
    .map((group) => {
      const sections = group.sections
        // Drop hidden sections — but never a required one (compliance).
        .filter((s) => !(hidden.has(s.id) && !isRequiredSection(s)))
        .map((s, baseIdx) => ({ s, baseIdx }))
        .sort(
          (a, b) =>
            orderKey(sectionOrder, a.s.id, a.baseIdx) -
            orderKey(sectionOrder, b.s.id, b.baseIdx)
        )
        .map(({ s }) => s);

      return {
        ...group,
        sections,
        defaultExpanded: collapsed.has(group.id)
          ? false
          : group.defaultExpanded,
      };
    })
    // Drop groups emptied by hiding (keeps nav clean). A group containing a
    // required section can never empty, since required sections can't be hidden.
    .filter((group) => group.sections.length > 0);

  return groups
    .map((group, baseIdx) => ({ group, baseIdx }))
    .sort(
      (a, b) =>
        orderKey(groupOrder, a.group.id, a.baseIdx) -
        orderKey(groupOrder, b.group.id, b.baseIdx)
    )
    .map(({ group }) => group);
}

export interface LayoutView {
  /** Base layout with the delta applied (hidden removed, reordered). */
  groups: SectionGroup[];
  /** True for a base section the active delta hides. Required sections are
   *  never hidden (resolveLayout enforces that), so this is always false for
   *  them. Unknown ids return false. */
  isHidden: (sectionId: string) => boolean;
}

/**
 * Convenience view over `resolveLayout` for consumers that render sections
 * individually (rather than mapping over `groups`): exposes both the resolved
 * groups and an `isHidden` predicate derived from the same merge, so nav and
 * body stay consistent.
 */
export function layoutView(
  base: SectionGroup[],
  delta?: FormLayoutDelta | null
): LayoutView {
  const groups = resolveLayout(base, delta);
  const visible = new Set(groups.flatMap((g) => g.sections.map((s) => s.id)));
  const baseIds = new Set(base.flatMap((g) => g.sections.map((s) => s.id)));
  return {
    groups,
    isHidden: (id: string) => baseIds.has(id) && !visible.has(id),
  };
}
