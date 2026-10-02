# Authority-Aware Autocomplete

A smart autocomplete component for CDWA reference fields (creators, materials, places, etc.) that seamlessly integrates external reference sources while keeping the experience simple for catalogers.

## Design Principles

1. **Works Without Network** - The component functions fully offline using local data
2. **Authorities Are Optional** - Users can type any value; linking is a bonus, not a requirement
3. **Local First** - Previously-used values always appear before external suggestions
4. **No Jargon** - Terms like "URI", "authority", "linked data" never appear in the UI
5. **Progressive Enhancement** - Basic text entry → local suggestions → external matches

## User Experience

### What Users See

**Input States:**
```
┌─────────────────────────────────────────────────────┐
│ Claude Monet                                    [×] │
│ ✓ Verified in reference sources                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ J. Smith                                        [×] │
│   (No matches found - that's OK!)                   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Oil on canvas                                   [×] │
└─────────────────────────────────────────────────────┘
```

**Dropdown Suggestions:**
```
┌─────────────────────────────────────────────────────┐
│ 🔍 Claude Mo                                        │
├─────────────────────────────────────────────────────┤
│ RECENTLY USED                                       │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Claude Monet                                    │ │
│ │ French painter, 1840-1926                   [↗] │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ REFERENCE SOURCES                                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Monet, Claude                                   │ │
│ │ French Impressionist painter • Getty ULAN  [↗] │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Claude Monet                                    │ │
│ │ painter (1840-1926) • Wikidata             [↗] │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ─────────────────────────────────────────────────── │
│ ➕ Use "Claude Mo" as entered                       │
└─────────────────────────────────────────────────────┘
```

### Interaction Flow

1. **User types** → Immediate local search (no network delay)
2. **After 300ms** → Fetch external suggestions (non-blocking)
3. **User selects** → Value populated, optional reference info saved
4. **User presses Enter** → Uses text as-is (no reference link)

## Component Behavior

### Autocomplete Priority Order

| Priority | Source | Description | Badge |
|----------|--------|-------------|-------|
| 1 | Recent | Values this user entered recently | (none) |
| 2 | Organization | Values used by anyone in this org | "Used in collection" |
| 3 | Local Vocabulary | Custom terms defined by the org | "Local term" |
| 4 | Getty (ULAN/AAT/TGN) | Getty vocabularies | "Getty ULAN" etc. |
| 5 | Wikidata | Wikidata entities | "Wikidata" |
| 6 | VIAF | Virtual International Authority File | "VIAF" |

### Selection Modes

**Quick Select (Click or Enter on suggestion)**
- Uses the display label
- Automatically saves reference link if available
- User doesn't need to think about it

**Manual Entry (Enter with no selection)**
- Uses exactly what was typed
- No reference link
- Always available as escape hatch

**Advanced: Link Later**
- User can add reference links to existing values via edit mode
- Batch linking tool available for administrators

## Visual States

### Input Field States

| State | Visual | Description |
|-------|--------|-------------|
| Empty | Standard input | Placeholder: "Start typing..." |
| Typing | Input + dropdown | Shows suggestions as user types |
| Linked | Input + checkmark | Has reference link (green subtle) |
| Unlinked | Input only | No reference link (no indicator) |
| Loading | Input + spinner | Fetching external suggestions |
| Offline | Input + cloud-off | External sources unavailable |
| Error | Input + warning | Search failed (still functional) |

### Suggestion Item States

| Type | Icon | Right Badge | Action |
|------|------|-------------|--------|
| Recent | Clock | (none) | Select |
| Org | Building | "Used in collection" | Select |
| Getty | (none) | "Getty ULAN" | Select |
| Wikidata | (none) | "Wikidata" | Select |
| Create New | Plus | (none) | Use as entered |

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `↓` / `↑` | Navigate suggestions |
| `Enter` | Select highlighted or use as typed |
| `Tab` | Select highlighted and move to next field |
| `Escape` | Close dropdown, keep current value |
| `Ctrl+Enter` | Use text as-is (skip suggestions) |

## Accessibility

- Full keyboard navigation
- ARIA live regions for suggestion count
- Screen reader announces: "3 suggestions available. Claude Monet, French painter, from Getty ULAN. Press Enter to select or keep typing."
- Focus management follows WAI-ARIA combobox pattern
