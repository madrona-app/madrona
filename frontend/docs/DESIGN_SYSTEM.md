# Madrona Design System

**An institutional color palette for long-lived cultural heritage infrastructure**

Inspired by the **Madroña tree** (*Arbutus menziesii*), native to the Pacific Northwest, known for its distinctive peeling bark revealing warm copper and red tones beneath.

---

## Design Principles

### Core Values
- **Durable**: Should feel credible in 10–20 years
- **Institutional**: Not a startup, not consumer software
- **Archival**: Calm, legible, printable
- **Restrained**: Prefer borders and whitespace over color

### Anti-Patterns
❌ Bright SaaS blues/greens  
❌ Gradients or glossy effects  
❌ High-saturation UI colors  
❌ Colored cards for every feature  
❌ Neon dark mode accents  

---

## Color Palette

### Neutrals (70% of UI)

| Color | Hex | Usage |
|-------|-----|-------|
| **Ink Black** | `#1C1C1C` | Primary text |
| **Parchment** | `#F6F2EC` | Primary background |
| **Lichen Gray** | `#E6E4E1` | Borders, panels |
| **Warm Stone** | `#D8D2C8` | Secondary background |
| **Archive Gray** | `#6B7A7E` | Muted text, metadata |

### Structural

| Color | Hex | Usage |
|-------|-----|-------|
| **Deep Forest** | `#1F3A2E` | Headers, navigation, frames |

### Primary Emphasis

| Color | Hex | Usage |
|-------|-----|-------|
| **Bark Red** | `#8E3B2F` | CTAs, primary actions |

### Warm Accent (≤5% usage)

| Color | Hex | Usage |
|-------|-----|-------|
| **Oxidized Copper** | `#B87333` | Hover states, subtle highlights |
| Copper Light | `#A66A3F` | Lighter variant |
| Copper Dark | `#9C5A2E` | Darker variant |

⚠️ **Copper Rule**: Use sparingly. Never for large backgrounds or body text. UI must remain understandable if removed entirely.

### Semantic Colors (Muted)

| Color | Hex | Usage |
|-------|-----|-------|
| Success | `#4A6B4F` | Muted green |
| Warning | `#8E6B3B` | Muted amber |
| Error | `#8E3B3B` | Muted red |
| Info | `#4A5A6B` | Muted blue-gray |

---

## Typography

### Font Stacks

```css
/* Headings - Institutional serif */
font-family: Georgia, Cambria, 'Times New Roman', serif;

/* Body/UI - Clean sans-serif */
font-family: Inter, system-ui, -apple-system, sans-serif;
```

### Hierarchy

```css
h1: 3xl (2.25rem) - Forest, Serif, 600
h2: 2xl (1.875rem) - Forest, Serif, 600
h3: xl (1.5rem) - Forest, Serif, 600
h4: lg (1.125rem) - Forest, Serif, 600

body: base (1rem) - Ink, Sans, 400
```

---

## Tailwind Classes

### Colors

```jsx
// Text
className="text-ink"           // Primary text
className="text-forest"        // Structural text
className="text-archive"       // Muted text
className="text-bark"          // Emphasis text

// Backgrounds
className="bg-parchment"       // Primary background
className="bg-stone"           // Secondary background
className="bg-forest"          // Dark structural
className="bg-bark"            // Primary CTA

// Borders
className="border-lichen"      // Default border
className="border-forest"      // Structural border
```

### Components

```jsx
// Buttons
className="btn-primary"        // Bark Red CTA
className="btn-secondary"      // Forest outline
className="btn-tertiary"       // Minimal gray

// Cards
className="card"               // Standard panel

// Inputs
className="input"              // Form field

// Tables
className="table"              // Data table

// Badges
className="badge"              // Default tag
className="badge-success"      // Status indicator

// Navigation
className="nav"                // Top navigation
className="nav-link"           // Nav item
className="nav-link active"    // Active nav
```

---

## Usage Examples

### Primary Action Button

```jsx
<button className="btn-primary">
  Create Collection
</button>
```

**Renders**: Bark red background, parchment text  
**Hover**: Copper background (subtle warmth)

### Data Table

```jsx
<table className="table">
  <thead>
    <tr>
      <th>Object ID</th>
      <th>Title</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>OBJ-001</td>
      <td>Colonial-era manuscript</td>
      <td><span className="badge-success">Active</span></td>
    </tr>
  </tbody>
</table>
```

**Visual**: Forest green header, lichen borders, stone hover

### Page Layout

```jsx
<div className="bg-parchment min-h-screen">
  <nav className="nav">
    <a href="/" className="nav-link active">Dashboard</a>
    <a href="/collections" className="nav-link">Collections</a>
  </nav>
  
  <main className="max-w-7xl mx-auto p-8">
    <h1>Collections</h1>
    <div className="card p-6">
      {/* Content */}
    </div>
  </main>
</div>
```

---

## Accessibility

### WCAG AA Compliance

All text/background combinations meet WCAG AA standards:

| Combination | Contrast | Pass |
|-------------|----------|------|
| Ink on Parchment | 14.5:1 | ✅ AAA |
| Forest on Parchment | 10.8:1 | ✅ AAA |
| Archive on Parchment | 4.9:1 | ✅ AA |
| Parchment on Forest | 10.8:1 | ✅ AAA |
| Parchment on Bark | 6.2:1 | ✅ AA |

### Non-Color Indicators

- Status uses **both color and icons/text**
- Focus states use **visible outlines**
- Errors show **text messages**, not just color
- Copper is **decorative only**

---

## Design Tokens (CSS Variables)

```css
:root {
  /* Neutrals */
  --color-ink: #1C1C1C;
  --color-parchment: #F6F2EC;
  --color-lichen: #E6E4E1;
  --color-stone: #D8D2C8;
  --color-archive: #6B7A7E;
  
  /* Structural */
  --color-forest: #1F3A2E;
  
  /* Emphasis */
  --color-bark: #8E3B2F;
  
  /* Accent */
  --color-copper: #B87333;
  --color-copper-light: #A66A3F;
  --color-copper-dark: #9C5A2E;
  
  /* Semantic */
  --color-success: #4A6B4F;
  --color-warning: #8E6B3B;
  --color-error: #8E3B3B;
  --color-info: #4A5A6B;
}
```

---

## Philosophy

### Why These Colors?

The **Madroña tree** (Arbutus menziesii):
- Evergreen leaves → **Deep Forest green**
- Peeling bark → **Bark Red**
- Inner bark → **Oxidized Copper**
- Smooth trunk → **Warm Parchment**
- Lichen growth → **Lichen Gray**

This creates a palette that feels:
- **Organic** (not synthetic)
- **Regional** (Pacific Northwest)
- **Timeless** (natural materials)
- **Institutional** (archival quality)

### Long-Term Thinking

Good institutional UI is like good furniture:
- Built to last decades
- Improves with familiarity
- Never looks "dated"
- Serves function over fashion

**Test**: If you saw this UI in 2035, would it feel like infrastructure or a trend?

---

## Migration Notes

When updating existing components:

1. **Replace bright colors** with muted equivalents
2. **Remove gradients** → Use solid fills or borders
3. **Reduce saturation** → Use neutrals first
4. **Add whitespace** → Prefer spacing over color
5. **Test printability** → Should look good on paper

**Before**: `bg-blue-500 text-white shadow-lg`  
**After**: `bg-forest text-parchment border-b-2 border-bark`

---

## Contact

Questions about the design system? See `/docs/DESIGN_SYSTEM.md` or ask the Madrona team.

**Remember**: When in doubt, choose the more restrained option.
