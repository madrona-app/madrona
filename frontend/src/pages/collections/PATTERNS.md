# Collections Page Pattern Spec

Reference: `CollectionObjectsPage.tsx` (list), `CollectionObjectWorkspacePage/` (workspace)

---

## LIST PAGE PATTERNS

### L01. Outer wrapper
```
className="max-w-6xl mx-auto"
```
No padding, no spacing classes. Each section manages its own bottom margin.

### L02. Header card
```
className="bg-parchment border border-lichen rounded-lg p-6 mb-6"
```
Structure:
```tsx
<div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
    <div className="flex items-center gap-4 min-w-0">
      <div className="p-3 bg-bark/10 rounded-lg shrink-0">
        <Icon size={28} className="text-bark" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Title</h1>
        <p className="text-sm text-archive mt-0.5">{count text}</p>
      </div>
    </div>
    {/* Create button */}
  </div>
  <p className="text-sm text-archive leading-relaxed">Description text.</p>
</div>
```

### L03. Count text pattern
```tsx
{data?.total !== undefined ? (
  data.total === 0 ? <span>No {items} yet</span>
  : data.total === 1 ? <span>1 {item}</span>
  : <span>{data.total.toLocaleString()} {items}</span>
) : (
  <span className="animate-pulse">Loading...</span>
)}
```

### L04. Create button (enabled)
```
className="btn btn-primary flex items-center justify-center gap-2 no-underline shrink-0 sm:self-auto self-start"
```
Component: `<Link>`. Icon: `Plus size={18}`.

### L05. Create button (disabled)
```
className="btn btn-primary flex items-center justify-center gap-2 opacity-50 cursor-not-allowed shrink-0 sm:self-auto self-start"
```
Component: `<span>`. `title="Requires collections.create permission"`.

### L06. Search hero element
```
className="bg-parchment border border-lichen rounded-lg p-6 mb-8 shadow-sm"
```
Note: `mb-8` (not `mb-6`). Has `shadow-sm`.

### L07. Search input
```tsx
<div className="relative flex-1 w-full">
  <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
  <input className="input w-full pl-12 pr-4 py-3 text-lg" />
  {searchQuery && (
    <button className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink">
      <X size={18} />
    </button>
  )}
</div>
```
`text-lg`, `py-3`. Search icon size 20 at left-4. X clear button at right-4.

### L08. Table wrapper
```tsx
<div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
```
NOT `card`. Explicit `bg-parchment`. Opacity transition on fetch.

### L09. Table head
```tsx
<thead className="bg-stone/50">
```
Class on `<thead>`, not on `<tr>`.

### L10. Table header cells
```
className="px-4 py-3 text-left text-sm font-medium text-ink"
```
Center-aligned columns: `text-center` instead of `text-left`.
Empty action column: `className="w-12 px-4 py-3"` (or `w-10`).

### L11. Table body
```
className="divide-y divide-lichen"
```

### L12. Row component (extracted)
Must be a separate function component (not inline in `.map()`).
```tsx
function EntityRow({ entity, onClick, onDelete }: Props) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
```
Hover state managed by component state, not CSS `:hover`.

### L13. Empty state — no search results
```tsx
<div className="text-center py-16">
  <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
    <Search size={32} className="text-archive" />
  </div>
  <h3 className="text-xl font-serif font-medium text-forest mb-3">
    No {items} match your search
  </h3>
  <p className="text-archive max-w-md mx-auto mb-6">
    We couldn't find any {items} matching "{query}". Try adjusting your search terms or clearing some filters.
  </p>
  <div className="flex items-center justify-center gap-3">
    <button onClick={clearFilters} className="btn btn-secondary">
      <X size={16} className="mr-1.5" />
      Clear filters
    </button>
  </div>
</div>
```

### L14. Empty state — first time (no data)
```tsx
<div className="text-center py-16">
  <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
    <Sparkles size={40} className="text-bark" />
  </div>
  <h3 className="text-2xl font-serif font-medium text-forest mb-3">Title</h3>
  <p className="text-archive max-w-lg mx-auto mb-2">Primary description.</p>
  <p className="text-sm text-archive/70 max-w-lg mx-auto mb-8">Secondary description.</p>
  <div className="flex items-center justify-center gap-4">
    {/* Create button: "btn btn-primary flex items-center gap-2" */}
    {/* Disabled: "btn bg-archive/50 text-parchment cursor-not-allowed flex items-center gap-2" */}
  </div>
  {/* QuickTip cards */}
  <div className="mt-12 max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
    <QuickTip icon={} title="" description="" />
    <QuickTip icon={} title="" description="" />
    <QuickTip icon={} title="" description="" />
  </div>
</div>
```

### L15. QuickTip component
```tsx
function QuickTip({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 rounded-lg bg-stone/30">
      <div className="w-10 h-10 rounded-lg bg-parchment flex items-center justify-center mb-3 text-bark">{icon}</div>
      <h4 className="font-medium text-forest mb-1">{title}</h4>
      <p className="text-sm text-archive">{description}</p>
    </div>
  );
}
```

### L16. Pagination
```tsx
{data && data.total > LIMIT && (
  <div className="mt-6 flex items-center justify-between">
    <p className="text-sm text-accessible-gray">
      Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}
    </p>
    <div className="flex gap-2">
      <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
      <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
    </div>
  </div>
)}
```
Text color: `text-accessible-gray`. Buttons: `btn btn-tertiary text-sm`.

### L17. Scroll persistence
```typescript
const SCROLL_KEY = '{page-name}-scroll';
```
- `useLayoutEffect` on mount: restore from sessionStorage via `requestAnimationFrame`
- `useEffect` cleanup: save to sessionStorage
- Before navigation: `sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))`

### L18. Debounce pattern
```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch(searchQuery);
    setOffset(0);  // Reset pagination on search change
  }, 300);
  return () => clearTimeout(timer);
}, [searchQuery]);
```

### L19. Query config
```typescript
import { keepPreviousData } from '@tanstack/react-query';
// ...
placeholderData: keepPreviousData,
```
NOT `placeholderData: (prev) => prev`.

### L20. Smart skeleton
```typescript
const showSkeleton = isLoading && !data;
```
Only show loading skeleton when there's no prior data at all.

### L21. Constants
```typescript
const SCROLL_KEY = '{page-name}-scroll';
const LIMIT = 24;
```

### L22. Filter reset
Filter dropdowns must call `setOffset(0)` on change.

### L23. Navigation handler
```typescript
const handleEntityClick = (entityId: string) => {
  sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  navigate(`/organizations/${orgId}/collections/{entity-type}/${entityId}`);
};
```
Separate function. Saves scroll. Uses `navigate()` (NOT `window.location`).

### L24. Error state
```tsx
<div className="max-w-6xl mx-auto">
  <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
    Error loading {items}: {(error as Error).message}
  </div>
</div>
```

### L25. Permission gating
- Create button: `hasPermission('collections.create')`
- Delete button: `hasPermission('collections.delete')`
- Import from `usePermissions` hook

---

## WORKSPACE PAGE PATTERNS

### W01. File structure
```
EntityWorkspacePage/
  index.tsx       — slim orchestrator
  types.ts        — FormData, constants, section groups
  hooks.ts        — all hooks (data, form, sections, summaries)
  *Section.tsx    — one file per section
```

### W02. SectionOrderProvider wrapper
```tsx
export default function EntityWorkspacePage() {
  return (
    <SectionOrderProvider>
      <EntityWorkspacePageContent />
    </SectionOrderProvider>
  );
}
```

### W03. types.ts: FormData interface
- Named `FormData` (not FormState, EntityData, etc.)
- Flat structure. String defaults: `''`. Nullable refs: `string | null`. Arrays: `Type[]`.

### W04. types.ts: BaseSectionProps
Required fields: `orgId`, `objectId?`, `isEditing`, `isCreateMode`, `formData`, `updateField`, `handleFieldBlur`, `expandedSections`, `toggleSection`, `sectionRefs`, `getSectionOrder`.
Optional: `isEmpty`, `sectionSummaries`, `isRestricted`.

### W05. types.ts: Section group constants
- `PAGE_SECTION_GROUPS: SectionGroup[]` — groups with `id`, `label`, `icon`, `defaultExpanded`, `sections[]`
- `SECTION_GROUPS: Record<string, string>` — section ID to group ID
- `DEFAULT_SECTION_ORDER: Record<string, number>` — section ID to order within group
- `INITIAL_EXPANDED_SECTIONS: Record<string, boolean>` — all `false`

### W06. types.ts: Option arrays
```typescript
export const ENTITY_TYPES = [
  { value: 'type_a', label: 'Type A' },
];
```
SCREAMING_SNAKE_CASE name. Array of `{ value, label }`.

### W07. hooks.ts: useEntityData
Returns: `orgId`, `entityId`, `isCreateMode`, `entity`, `isLoading`, `error`, related data, `queryClient`.

### W08. hooks.ts: useFormState
- State: `formData`, `saveStatus`, `lastSaved`, `hasUnsavedChanges`
- Methods: `updateField`, `updateFieldSilent`, `handleFieldBlur`, `performSave`
- `performSave` (NOT `handleSave`)
- `lastSaved` tracked: set `new Date()` on mutation success
- Mutation `onSuccess`: invalidates queries

### W09. hooks.ts: useSectionState
- `expandedSections`, `toggleSection`, `sectionRefs`, `getSectionOrder`
- `raisedSectionId`, `raiseSection`, `lowerAllSections`
- `getSectionOrder` returns group offset (n * 100) + section index

### W10. hooks.ts: useSectionSummaries
Returns `Record<string, string | undefined>`. Concise summaries using `·` separator.

### W11. hooks.ts: useHasContent
Returns `Record<string, boolean>`. Checks arrays for length, strings for truthy.

### W12. index.tsx: Click-to-edit pattern
```typescript
const handleEnterEditMode = useCallback((sectionId: string) => {
  setExpandedSections(prev => {
    const newState: Record<string, boolean> = {};
    Object.keys(prev).forEach(key => { newState[key] = key === sectionId; });
    return newState;
  });
  raiseSection(sectionId);
}, [raiseSection, setExpandedSections]);
```
Used as `onSectionNavigate={handleEnterEditMode}`.

### W13. index.tsx: toggleMode with query invalidation
```typescript
if (!newMode) {
  lowerAllSections();
  queryClient.invalidateQueries({ queryKey: ['entity-key', orgId, entityId] });
}
```

### W14. index.tsx: Sections container
```tsx
<div className="flex flex-col gap-4">
```
NOT `space-y-4`. Enables CSS `order` property.

### W15. index.tsx: SectionGroupDivider
```tsx
<SectionGroupDivider label="Group Label" icon={IconComponent} />
```
Between section groups.

### W16. index.tsx: WorkspaceSection rendering
```tsx
<WorkspaceSection
  id="sectionId"
  title="Section Title"
  icon={<Icon size={18} />}
  isExpanded={expandedSections.sectionId}
  onToggle={() => toggleSection('sectionId')}
  isEditing={isEditing}
  sectionRef={(el) => { sectionRefs.current['sectionId'] = el; }}
  order={getSectionOrder('sectionId')}
  isEmpty={!hasContent.sectionId}
  summary={sectionSummaries.sectionId}
>
```

### W17. index.tsx: WorkspaceHeader
```tsx
<WorkspaceHeader
  lastSaved={lastSaved}
  saveStatus={saveStatus}
  hasUnsavedChanges={hasUnsavedChanges}
  // ...
/>
```
Must pass `lastSaved`.

### W18. index.tsx: CreateTaskSlideOver
```tsx
<CreateTaskSlideOver
  isOpen={showCreateTask}
  onClose={() => setShowCreateTask(false)}
  orgId={orgId}
  initialEntityType="entity_type"
  initialEntityId={entityId}
  initialEntityLabel={label}
/>
```

### W19. RecordDetailPageWrapper
```tsx
<RecordDetailPageWrapper
  pageType="entity-type"
  sectionGroups={PAGE_SECTION_GROUPS}
  sectionIds={sectionIds}
  sectionData={sectionData}
  onSectionNavigate={handleEnterEditMode}
  callbacks={{ onDelete, onCreateTask: () => setShowCreateTask(true) }}
/>
```

### W20. DO NOT USE
- `EditModeIndicator` — removed
- `onEdit` callback — use `onSectionNavigate`
- `ProcedureWorkflowGuide` — removed
- Generic Tailwind colors (`green-500`, `blue-500`, `gray-*`)
- `text-white` — use `text-parchment`
- `space-y-4` on sections container — use `flex flex-col gap-4`
