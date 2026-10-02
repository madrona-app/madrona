# Madrona UI Principles

**Version:** 1.0  
**Date:** January 7, 2026  
**Purpose:** Codify the institutional design stance to prevent regression as features are added.

---

## Core Philosophy

Madrona is infrastructure software for cultural heritage institutions. The UI must communicate:

- **Persistence** over action
- **State** over completion
- **Continuity** over workflow
- **Trust** over celebration

This is not a startup dashboard, not consumer software, and not marketing UI.  
This is institutional software that happens to be usable.

---

## The Central Question

Every design decision should answer:

> **"What kind of software are we being?"**

We are being: **infrastructure you can trust not to surprise you.**

---

## 1. Silence Rules

### When NOT to show status

- **Nominal state** = silence
  - If a system is "all set" / "in sync" / "healthy" → show nothing
  - Only speak when non-nominal (synchronizing, error, warning)
  - Absence implies normalcy

### When NOT to show timestamps

- **Currency matters, not recency**
  - Prefer: "Current as of 3 hours ago"
  - Avoid: "Last sync 3 hours ago" (action-centric)
  - Avoid: "Synchronized 3 hours ago" (event-centric)

### When NOT to show affirmations

- **No celebratory UI**
  - No green success pills
  - No "job done" fireworks
  - No dopamine triggers
  - Status = neutral dot + text, not celebration

**Principle:**  
Infrastructure doesn't announce that it's okay — it only speaks when it isn't.

---

## 2. Diagram Grammar

### What connectors mean

- **Straight lines** = topology, relationship, alignment
- **NOT curved lines** = those read as "step 1 → step 2" (procedural)
- **Muted colors** (Warm Stone #D8D2C8) = structural, not actionable
- **No animation unless active** = avoid "builder tool" vibe

### What cards mean

- **Cards are annotations**, not widgets
- **Placed on canvas**, not floating above it
- **Minimal borders** (Warm Stone), no shadows
- **Serif headings** (Georgia) carry authority
- **Status dots** appear only when non-nominal

### What absence means

- **Empty cards** = nominal state
- **Missing edges** = no active synchronization
- **No timestamp** = not yet activated

**Principle:**  
The diagram says: "These systems are in relationship" —  
NOT: "This thing runs, then that thing runs."

---

## 3. Color Usage

### Color hierarchy (by frequency)

1. **Neutrals (70%)**: Ink, Parchment, Lichen, Stone, Archive
2. **Structural (20%)**: Forest (headers, nav, borders)
3. **Emphasis (≤10%)**: Bark (CTAs, primary actions)
4. **Accent (≤5%)**: Copper (hover only, decorative)

### What colors never do

- **Never celebrate** (no bright green "success")
- **Never interpret** (no blue "analytics" numbers)
- **Never compete** with structure (hierarchy is typographic, not chromatic)

### Semantic colors (when required)

- Success: `#4A6B4F` (muted forest green)
- Warning: `#8E6B3B` (muted ochre)
- Error: `#8E3B3B` (muted brick)
- Info: `#4A5A6B` (muted slate)

**All muted. No bright colors.**

**Principle:**  
Color supports structure. Typography leads.

---

## 4. Typography

- **Serif headings** (Georgia, Cambria) = authority, durability
- **Sans body** (Inter, system-ui) = clarity, readability
- **Weight hierarchy** = 500 (normal), 600 (emphasis), 700 (rare)
- **No decorative fonts**

**Principle:**  
Hierarchy is typographic, not chromatic.

---

## 5. Language

### Prefer state over action

| ❌ Avoid (action-first)        | ✅ Use (state-first)          |
|--------------------------------|-------------------------------|
| "Last sync 3 hours ago"        | "Current as of 3 hours ago"   |
| "Normalize + Track Changes"    | "Canonical alignment"         |
| "Success"                      | "In sync"                     |
| "Export Dataset"               | "Export snapshot"             |
| "Source / Destination"         | "Source system / Downstream system" |

### Infrastructure language over tool language

- Prefer: **"Source system"** (infrastructure)
- Avoid: **"Source"** (tool component)

- Prefer: **"Canonical alignment"** (what it preserves)
- Avoid: **"Canonical processing"** (what it does)

**Principle:**  
From: "Here is a pipeline you configured"  
To: "Here is infrastructure that is holding"

---

## 6. Interaction Model

### Buttons

- **Primary actions** = Bark border (`#8E3B2F`), transparent background, no fill
- **Secondary actions** = Archive gray border (`#6B7A7E`), transparent
- **No bright CTAs** = export is expected, not encouraged

### Hover states

- **Subtle** = Parchment fill (`#F6F2EC`) on transparent buttons
- **No lift** = cards are placed, not floating
- **No scale** = institutional restraint

### Focus states

- **Bark accent** (`#8E3B2F`) for keyboard navigation
- **2px outline**, 2px offset
- **No glow**, no drop shadow

**Principle:**  
Affordances are present but not dominant.

---

## 7. Tables & Lists

### Table design

- **Record, not dashboard**
- No colored numbers (green "New", blue "Updated")
- Use Ink (`#1C1C1C`) for data, Archive gray (`#6B7A7E`) for labels
- Column labels do interpretive work, not color

### Status indicators

- **Dots, not pills** (6px circle + text)
- **Only when non-nominal** (remove "All set" repetition)
- **Muted colors** from semantic palette

**Principle:**  
Let structure carry meaning, not color.

---

## 8. Dark Mode Readiness

**Rule:** Nothing should become brighter in dark mode than it is in light mode.

- **Background:** Night Ink (`#0F0F0F`)
- **Cards:** Charcoal (`#1F1F1F`)
- **Borders:** Ash gray (`#3A3A3A`)
- **Text:** Parchment (`#F6F2EC`)
- **No glowing text**
- **No increased saturation**
- **No contrast-for-contrast's-sake**

**Principle:**  
If dark mode feels boring, you did it right. It should feel like an after-hours reading room, not a control panel.

---

## 9. What to Avoid

### Never use

- ❌ Emojis (undermine seriousness)
- ❌ Bright green success states (celebratory)
- ❌ Animated loaders (unless synchronizing)
- ❌ Drop shadows on cards (they're placed, not floating)
- ❌ Rounded corners >4px (institutional restraint)
- ❌ Gradient backgrounds (not SaaS)
- ❌ Marketing language ("Supercharge your workflow")

### Never say

- ❌ "All set" repeatedly (silence is better)
- ❌ "Job complete" (completion-focused)
- ❌ "Last sync X ago" (action-centric)
- ❌ Tool language when infrastructure language exists

---

## 10. Questions to Ask Before Shipping

Before adding any new feature, ask:

1. **Does this privilege state or action?**  
   → Should privilege state.

2. **Does this feel like infrastructure or like a tool?**  
   → Should feel like infrastructure.

3. **Would this embarrass us in front of librarians?**  
   → If yes, rethink.

4. **Will this age badly in five years?**  
   → If yes, simplify.

5. **Does silence work here, or do we need to speak?**  
   → Prefer silence when nominal.

---

## 11. The Honest Assessment

If the UI:

- Would not embarrass you in front of archivists
- Would not trigger "startup skepticism"
- Would age well over several years
- Supports the argument Madrona is making

**→ You're aligned with these principles.**

---

## Enforcement

This document is a living standard. When adding features:

1. Reference these principles in code reviews
2. Use this as a design checklist
3. Update this document if principles evolve
4. Prevent regression — institutional UI is hard-won

---

## Summary

**Madrona UI says:**

> "Here is infrastructure you can trust not to surprise you."

Not:
- "Here is a pipeline you configured"
- "Here is a tool you're using"
- "Here is a workflow you're running"

**We are building software for institutions that will outlive us.**

The UI should reflect that.

---

**End of Madrona UI Principles v1.0**
