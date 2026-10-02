# Navigation Governance

This document defines the binding rules for navigation design across all Madrona applications. These rules exist to prevent cognitive overload as the platform scales to 8-10 apps.

**Status**: Approved and enforced
**Last updated**: 2026-02-01

---

## Core Principles

1. **Navigation answers one question**: "Where do I go to do my daily work?"
2. **Fewer items always wins** over discoverability
3. **Power users drill down**; casual users scan top-level
4. **Permissions shape views, not navigation**

---

## Binding Rules

### Rule 1: Cross-app concepts are forbidden in app navigation

The following concepts must live **only in the global shell**, never inside an app:

- My Tasks
- Recent Items
- Quick Actions
- Work Sets / Workspaces
- Activity feeds
- Notifications

**Why**: If it applies to "any record in the system," it's a platform feature, not an app feature. Duplicating creates N task inboxes users must check.

### Rule 2: Configuration is never top-level

The following must always be grouped under "Settings" or "Tools":

- Templates (of any kind)
- Tag/taxonomy configuration
- Watermarks, presets, defaults
- Scheduled jobs
- App-specific configuration pages

**Why**: These are setup tasks used weekly by <5% of users. Hiding reduces cognitive load for the 95% who don't need them today.

### Rule 3: Collapsed-by-default groups are mandatory

Groups labeled "Tools" or "Settings" must:

- Default to collapsed state
- Contain only power-user or admin features
- Never contain primary work destinations

**Why**: Reduces scannable items on initial load.

### Rule 4: Permissions shape views, not navigation

**Wrong**:
```
Download Requests
├── My Requests (view permission)
└── All Requests (review permission)
```

**Right**:
```
Download Requests (single page)
  → Page filters by permission internally
  → Users with 'review' see all + admin controls
  → Users with 'view' see only their own
```

**Why**: Duplicating pages for roles creates 2N navigation items where N suffices.

### Rule 5: Reports get one nav entry

**Wrong**:
```
Reports
├── All Reports
├── Templates
└── Scheduled
```

**Right**:
```
Reports (single entry)
  → Templates accessible via tab within page
  → Scheduled accessible via tab within page
```

**Why**: Templates and schedules are configuration, not destinations.

### Rule 6: Top-level item ceiling

Each app should have:

- **Maximum 6 top-level items** when collapsed
- **Maximum 3 primary destinations** (daily work)
- **Remaining items** grouped under Tools/Settings/Reports

---

## Standard App Structure

Every app should follow this pattern:

```
[App Name]
├── [Primary destination 1]     ← Daily work
├── [Primary destination 2]     ← Daily work
├── [Primary destination 3]     ← Daily work (optional)
│
├── Tools [collapsed]           ← Operational utilities
│   ├── ...
│   └── ...
│
├── Settings [collapsed]        ← Configuration
│   ├── ...
│   └── ...
│
└── Reports                     ← Single entry point
```

---

## Global Shell Responsibilities

The global shell (platform chrome) owns:

| Feature | Path Pattern |
|---------|--------------|
| My Tasks | `/organizations/:orgId/work/tasks` |
| Recent Items | `/organizations/:orgId/work/recent` |
| Quick Actions | `/organizations/:orgId/work/actions` |
| Work Sets | `/organizations/:orgId/work/workspaces` |
| Notifications | Global header |
| User preferences | Global header menu |

Work Sets must support filtering by app/record type (Media assets, Collection objects, mixed).

---

## Migration Notes

When removing items from app navigation:

1. Keep routes functional (pages still exist)
2. Add redirects from old paths to new locations
3. Show toast/banner explaining the move (90 days)
4. Update bookmarks documentation

---

## Enforcement

Before merging navigation changes:

- [ ] Does this add a cross-app concept to an app? → Reject
- [ ] Does this add configuration to top-level? → Reject
- [ ] Does this create permission-based nav splits? → Reject
- [ ] Does this exceed 6 top-level items? → Reject
- [ ] Is the new group collapsed by default? → Required for Tools/Settings

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-01 | Initial governance established. Removed Work sections from Media and Collections apps. |
