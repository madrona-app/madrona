# Dark Mode Implementation

## Overview

Dark mode has been implemented as an **accessibility and longevity feature**, not a personalization feature. The implementation is intentionally minimal and administrative in character.

## Design Philosophy

- **Unobtrusive control**: Toggle is placed in the account dropdown, not prominently in navigation
- **Administrative tone**: Simple segmented control (Light/Dark/System), no sun/moon icons
- **Immediate switching**: No animated transitions between modes
- **System-aware**: Defaults to system preference if no user choice exists
- **Persistent**: User preference stored in localStorage

## Implementation Details

### Theme Context

**File**: `frontend/src/contexts/ThemeContext.tsx`

Provides:
- `theme`: Current user setting ('light' | 'dark' | 'system')
- `resolvedTheme`: Actual applied theme ('light' | 'dark')
- `setTheme()`: Function to change theme preference

Features:
- Listens to system preference changes when set to 'system'
- Persists preference to localStorage (`madrona-theme`)
- Automatically applies `.dark` class to `<html>` element

### Color Variables

**File**: `frontend/src/index.css`

Dark mode uses CSS custom properties that are redefined under `.dark` class:

**Backgrounds** (warm near-blacks with tonal layering):
```css
--color-parchment: #151615;    /* bg-primary: page background */
--color-lichen: #1E201E;       /* bg-surface: cards, modals, panels */
--color-stone: #2C2F2C;        /* border-subtle: dividers and outlines */
```

**Text** (warm off-whites):
```css
--color-ink: #E8E4DE;          /* text-primary */
--color-archive: #B9B4AC;      /* text-secondary */
```

**Brand Accents** (use sparingly):
```css
--color-forest: #1F3A2E;       /* Brand green */
--color-bark: #9A4436;         /* Brand red-brown */
--color-copper: #C07A3F;       /* Decorative only, ≤5% usage */
```

**Semantic** (WCAG AA compliant):
```css
--color-success: #6B9B6F;
--color-warning: #B8934B;
--color-error: #B85B4B;
--color-info: #6B8B9B;
```

**Design Rules:**
- No gradients, glow effects, or neon colors
- Prefer tonal layering over shadows
- Copper is decorative only (hover, markers)
- All text/background combinations meet WCAG AA contrast requirements

### Theme Toggle UI

**Location**: Account dropdown (OrganizationSwitcher component)

**Appearance**:
```
┌─────────────────────────────────┐
│ Appearance                       │
│ ┌─────────────────────────────┐ │
│ │ Light │ Dark │ System      │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**Characteristics**:
- Simple segmented control with three options
- Selected state: white background with shadow
- Unselected state: transparent with hover
- No icons, no decoration
- Labeled section: "APPEARANCE"

### Integration

The `ThemeProvider` wraps the entire application in `App.tsx`:

```tsx
<ThemeProvider>
  <AuthProvider>
    <OrgProvider>
      {/* Application routes */}
    </OrgProvider>
  </AuthProvider>
</ThemeProvider>
```

### Tailwind Configuration

**File**: `frontend/tailwind.config.js`

Enabled class-based dark mode:
```js
darkMode: 'class'
```

This allows Tailwind's `dark:` variant to work based on the `.dark` class on the `<html>` element.

## Usage in Components

To make components dark-mode aware, use Tailwind's `dark:` variant:

```tsx
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  Content
</div>
```

Or use the CSS custom properties directly:

```tsx
<div style={{ background: 'var(--color-parchment)', color: 'var(--color-ink)' }}>
  Content
</div>
```

**Recommendation**: Prefer CSS custom properties for institutional UI elements to maintain consistency with the Madrona design system.

## Testing

To test dark mode:

1. Open account dropdown (click username in nav bar)
2. Click "Dark" under Appearance section
3. Verify immediate switch with no animation
4. Click "System" to test system preference integration
5. Change system preference to verify it responds

## Future Considerations

### Component Coverage

Current implementation provides:
- ✅ Theme switching infrastructure
- ✅ CSS variable system
- ✅ User preference persistence
- ⏳ Individual component dark mode styling (in progress)

Most components currently use inline styles with fixed colors. These should gradually migrate to:
1. CSS custom properties for institutional elements
2. Tailwind `dark:` variants for utility-based components

### Accessibility

Dark mode should be validated for:
- WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text)
- Reduced motion preferences
- High contrast mode compatibility

### Print Styling

Dark mode should be overridden for print:
```css
@media print {
  .dark {
    /* Force light mode for print */
  }
}
```

## Architecture Notes

**Why not theme toggle in main navigation?**
- Dark mode is an administrative preference, not a primary feature
- Placing it prominently would suggest personalization/customization focus
- Account dropdown is the appropriate context for user preferences

**Why no animated transitions?**
- Instant feedback is more professional
- Animations can be distracting in productivity tools
- Simpler implementation, fewer edge cases

**Why three options (Light/Dark/System)?**
- "System" respects user's OS-level preference
- Allows institutional defaults while permitting overrides
- Standard pattern in professional tools

## Related Files

- `frontend/src/contexts/ThemeContext.tsx` - Theme state management
- `frontend/src/components/OrganizationSwitcher.tsx` - Theme toggle UI
- `frontend/src/index.css` - Dark mode color variables
- `frontend/tailwind.config.js` - Tailwind dark mode config
- `frontend/src/App.tsx` - ThemeProvider integration
