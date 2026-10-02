# Dataset-First UX Contract
## Internal Product Specification – v1.0

**Date:** January 6, 2026  
**Status:** Draft  
**Audience:** Product, Engineering, Design  
**Purpose:** Define Dataset as the primary mental model for users

---

## Executive Summary

Madrona's UX is shifting from a **connector-first** model to a **dataset-first** model. Users should think: *"I have collections data that needs to flow from PastPerfect to my website"* — not *"I need to configure a connector"*.

This document establishes:
- Dataset as the primary user-facing object
- Semantic language changes across the UI
- Dataset lifecycle, ownership, and permissions
- Flow visualization tied to datasets (not standalone routes)

**Non-goal:** This document does NOT include implementation details. Code changes follow separately.

---

## Core Principles

### 1. **Dataset as Primary Object**
- A Dataset represents a **logical collection of data** from a museum's systems
- Examples: "Collections Objects", "Donor Records", "Exhibition Calendar"
- Datasets have **sources** (where data comes from) and **destinations** (where data goes)
- Users create, configure, and monitor Datasets — not connectors or routes

### 2. **Connectors as Implementation Details**
- Connectors are **how** we connect to systems, not **what** users manage
- Users select "PastPerfect" as a source — they don't "configure a PastPerfect connector"
- Connector configuration UI appears inline within dataset setup

### 3. **Flows as Dataset Attributes**
- Each dataset has **its own flow** showing: Source → Processing → Destination
- Runs are always **contextual to a dataset** (no standalone run list)
- Flow dashboard shows "Collections Objects flow" not "Route #42"

### 4. **Natural Language Over Technical Jargon**
- "Where does this data come from?" not "Select source connector"
- "Where should this data go?" not "Configure destination route"
- "Your collections data is syncing" not "Route execution in progress"

---

## Language Changes

### Before (Connector-First Language)
| Old Term | Context | Problem |
|----------|---------|---------|
| "Connectors" | Top-level nav | Implies user manages integrations, not data |
| "Routes" | Top-level nav | Technical term, unclear to non-engineers |
| "Objects" | Data records | Generic, doesn't convey "this is MY collections data" |
| "Configure Connector" | Setup flow | Sounds technical, not outcome-focused |
| "Route Status" | Monitoring | User doesn't care about "routes" |

### After (Dataset-First Language)
| New Term | Context | User Benefit |
|----------|---------|--------------|
| "Datasets" | Top-level nav | Clear: these are my data collections |
| "Data Flows" | Sub-nav or inline | Shows movement, not infrastructure |
| "Records" or "Items" | Data records | Natural museum language |
| "Connect Your Data" | Setup flow | Outcome-focused, approachable |
| "Sync Status" | Monitoring | Clear: is my data up-to-date? |

### Specific UI Text Replacements

#### Navigation
```
Old: Home | Datasets | Connectors | Routes | Runs
New: Home | Datasets | Activity
```

#### Dataset List Page
```
Old: "Your datasets are powered by connectors"
New: "Your data collections and where they flow"
```

#### Dataset Detail Page
```
Old: "Source Connector: PastPerfect | Destination: Google Sheets"
New: "Source: PastPerfect | Destination: Google Sheets"

Old: "Route Configuration"
New: "Flow Settings"

Old: "Last Run: 2 hours ago"
New: "Last Sync: 2 hours ago"
```

#### Setup Wizard
```
Old: "Step 1: Configure Source Connector"
New: "Step 1: Connect Your Source Data"

Old: "Step 2: Select Destination Connector"
New: "Step 2: Choose Where Data Goes"

Old: "Step 3: Map Fields"
New: "Step 3: Map Your Fields" (no change needed)
```

#### Monitoring
```
Old: "Route Runs"
New: "Sync History"

Old: "Run Status: Running"
New: "Status: Syncing"

Old: "View Run Details"
New: "View Sync Details"
```

---

## Dataset Object Model

### Dataset Properties

```typescript
Dataset {
  // Identity
  dataset_id: UUID
  organization_id: UUID
  name: string                    // e.g., "Collections Objects"
  description: string             // e.g., "Artwork and artifacts from PastPerfect"
  
  // Source (where data comes from)
  source: {
    type: string                  // e.g., "pastperfect"
    connector_id: UUID            // Internal reference
    connection_name: string       // e.g., "PastPerfect Production"
    config: object                // Source-specific settings
    last_synced_at: timestamp
  }
  
  // Destination(s) (where data goes)
  destinations: [
    {
      type: string                // e.g., "google_sheets"
      connector_id: UUID
      connection_name: string     // e.g., "Public Collections Sheet"
      config: object
      status: "active" | "paused"
    }
  ]
  
  // Flow Configuration
  flow: {
    schedule: string              // e.g., "daily at 2am"
    field_mappings: object
    transformations: object
    sync_mode: "full" | "incremental"
  }
  
  // Metadata
  record_count: number
  created_by: UUID
  created_at: timestamp
  updated_at: timestamp
  status: "active" | "paused" | "error"
}
```

### Key Design Decisions

1. **Source is singular, Destinations are plural**
   - A dataset has ONE source of truth
   - But can flow to MULTIPLE destinations
   - Example: PastPerfect → [Google Sheets, Airtable, Website API]

2. **Connectors are embedded, not referenced**
   - Users don't "create a connector then link it"
   - Users "connect to PastPerfect" within dataset setup
   - Connector configuration is part of dataset lifecycle

3. **Runs are scoped to datasets**
   - No global "Runs" page showing all route executions
   - Each dataset has its own "Sync History" tab
   - Activity page shows recent syncs across all datasets

---

## Dataset Lifecycle

### Phase 1: Creation
**User Intent:** "I want to sync my collections data"

**Steps:**
1. Click "New Dataset" (not "New Connector")
2. Name dataset (e.g., "Collections Objects")
3. Choose source system (e.g., "PastPerfect")
4. Authenticate/configure source inline
5. Choose destination(s) (e.g., "Google Sheets")
6. Configure destinations inline
7. Map fields
8. Set sync schedule
9. Test sync (1 record preview)
10. Activate dataset

**Key UX Principles:**
- Wizard flow, not multi-page configuration
- Preview data at each step (show actual records)
- "Test Connection" buttons inline (not separate connector page)
- Clear progress indicator (8 steps → completion)

### Phase 2: Active Operation
**User Intent:** "I want to know my data is syncing correctly"

**Monitoring:**
- Dataset card shows: Status badge, last sync time, record count
- Flow visualization: Source → Processing → Destination(s)
- Sync history: Recent runs with success/failure indicators
- Activity feed: "Collections Objects synced 1,234 records" (not "Route 42 completed")

**Interaction:**
- Click dataset card → Flow detail view
- "Sync Now" button (manual trigger)
- "Pause Syncing" toggle
- "View Changes" (change log for this dataset)

### Phase 3: Modification
**User Intent:** "I need to add a new destination" or "Change sync schedule"

**Editing:**
- "Edit Flow" button → Inline editor (not separate page)
- Add/remove destinations without recreating dataset
- Adjust field mappings with live preview
- Change schedule via dropdown (not cron editor)

**Validation:**
- Test new configuration before saving
- Preview impact: "This will affect 1,234 records"
- Confirm destructive changes: "Removing Google Sheets will stop syncing there"

### Phase 4: Troubleshooting
**User Intent:** "Something went wrong, I need to fix it"

**Error States:**
- Dataset card shows "Error" badge
- Click → Error details with plain English explanation
- Actionable fix: "Reconnect to PastPerfect" (not "Connector authentication failed")
- Retry button: "Try Syncing Again"

**Support Resources:**
- "Get Help" button → Contextual docs (not generic help center)
- "Contact Support" pre-fills ticket with dataset context
- Activity log: Audit trail of changes to this dataset

### Phase 5: Archival
**User Intent:** "We don't use this data anymore"

**Options:**
- "Pause Syncing" (soft disable, data preserved)
- "Archive Dataset" (hidden from main list, data preserved)
- "Delete Dataset" (permanent, requires confirmation)

**Preservation:**
- Archived datasets appear in "Archived" filter
- Can be reactivated (no reconfiguration needed)
- Deleted datasets: 30-day soft delete (enterprise tier only)

---

## Dataset Permissions & Ownership

### Organization-Level Isolation
- Datasets belong to **one organization**
- Cannot be shared across organizations (security boundary)
- API keys scoped to organization → access all org's datasets

### User Roles & Permissions
| Role | Permissions |
|------|-------------|
| **Admin** | Create, edit, delete, pause all datasets. Manage API keys. |
| **Member** | View all datasets, trigger manual syncs, view sync history. Cannot edit flow configuration or delete. |
| **Viewer** (future) | Read-only access. Can view datasets and history but cannot trigger syncs. |

### Dataset Ownership
- **Creator:** User who created dataset (metadata only, not functional)
- **Responsibility:** Organization admins can modify any dataset
- **Audit Trail:** All changes logged with user_id + timestamp

### Visibility Rules
- **Within Organization:** All members see all datasets (no per-dataset ACLs for MVP)
- **Cross-Organization:** No visibility (hard boundary)
- **API Access:** API keys inherit organization-level dataset access

### Future Considerations (Post-MVP)
- **Dataset Tags:** Categorize by department (Collections, Development, Education)
- **Per-Dataset Permissions:** Grant specific users edit access
- **Dataset Sharing:** Export configuration as template (no data)

---

## Flow Visualization

### Concept: Dataset-Centric Flow View
Instead of a standalone "Routes" page showing abstract pipeline diagrams, each dataset has its own flow visualization showing:

```
┌─────────────────────────────────────────────────────────────┐
│ Collections Objects                          [Sync Now] [•••] │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌──────────┐      ┌──────────┐      ┌──────────────┐     │
│   │          │      │          │      │              │     │
│   │  Source  │ ───> │ Madrona  │ ───> │ Destinations │     │
│   │          │      │          │      │              │     │
│   └──────────┘      └──────────┘      └──────────────┘     │
│   PastPerfect       Transform         Google Sheets        │
│                     + Validate         Airtable             │
│                                                               │
│   Last Sync: 2 hours ago                                    │
│   Next Sync: in 22 hours (daily at 2am)                    │
│   Records: 1,234 synced successfully                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Flow States
| State | Visual | User Message |
|-------|--------|--------------|
| **Idle** | Gray | "Ready to sync" |
| **Syncing** | Blue, animated | "Syncing 1,234 records..." |
| **Success** | Green | "Synced 2 hours ago" |
| **Warning** | Yellow | "Some records skipped" |
| **Error** | Red | "Sync failed: Check connection" |

### Flow Actions (Contextual Buttons)
- **Sync Now** (if idle or error)
- **Pause** (if active)
- **View History** (always available)
- **Edit Flow** (admin only)

### Run Context (No Standalone Runs Page)
- Runs are accessed via dataset → "Sync History" tab
- Each run shows:
  - Timestamp
  - Duration
  - Records processed
  - Changes detected (creates, updates, deletes)
  - Errors/warnings (if any)
  - Detailed logs (click to expand)

---

## Activity Page (Replaces "Runs")

Instead of a technical "Runs" page, users see an **Activity Feed** showing recent sync events across all datasets:

```
Activity

Today
  ✓ Collections Objects synced 1,234 records          2:00 AM
  ✓ Donor Records synced 456 records                  2:15 AM
  ⚠ Exhibition Calendar synced 12 records (3 skipped) 2:30 AM

Yesterday
  ✓ Collections Objects synced 1,230 records          2:00 AM
  ✗ Donor Records failed to sync (authentication)     2:15 AM
  ✓ Exhibition Calendar synced 15 records             2:30 AM

[Load More]
```

### Activity Details
- Click any item → Jump to dataset detail + specific run
- Filter by: Dataset, Status, Date range
- Search: "Find when Collections Objects last failed"

---

## Dataset Detail Page Structure

### Tabs
1. **Overview** (default)
   - Flow visualization
   - Quick stats (record count, last sync, status)
   - Recent activity (last 5 syncs)

2. **Sync History**
   - Full list of runs for this dataset
   - Filters: Success/failure, date range
   - Export: CSV of run history

3. **Settings**
   - Edit source/destination configuration
   - Adjust field mappings
   - Change sync schedule
   - Pause/resume dataset
   - Delete dataset (with confirmation)

4. **Changes** (future)
   - Change log: What records were added/updated/deleted
   - Diff view: See what changed in specific records
   - Rollback: Restore previous state (enterprise only)

---

## User Scenarios

### Scenario 1: Small Museum (Starter Tier)
**Goal:** Sync PastPerfect collections to Google Sheets for website

**User Journey:**
1. Clicks "New Dataset"
2. Names it "Collections for Website"
3. Selects "PastPerfect" as source
4. Enters PastPerfect credentials
5. Tests connection (sees sample records)
6. Selects "Google Sheets" as destination
7. Authenticates Google account
8. Chooses existing sheet or creates new one
9. Maps fields (drag-and-drop or auto-suggest)
10. Sets schedule: "Daily at 2am"
11. Runs test sync (10 records preview)
12. Activates dataset
13. Sees flow visualization with "Syncing..." status
14. Gets email: "Collections for Website synced 1,234 records successfully"

**Key UX Wins:**
- Never saw the word "connector" or "route"
- Understood exactly what was happening at each step
- Saw real data preview (not abstract configuration)
- Clear confirmation of success

### Scenario 2: Mid-Size Museum (Professional Tier)
**Goal:** Sync collections to website AND donor data to Salesforce

**User Journey:**
1. Creates first dataset: "Collections Data"
   - Source: TMS
   - Destination: Google Sheets
2. Creates second dataset: "Donor Database"
   - Source: Blackbaud Raiser's Edge
   - Destination: Salesforce
3. Monitors both on Datasets page (2 cards)
4. Sees Activity feed: Both datasets syncing nightly
5. Gets alert: "Donor Database sync failed"
6. Clicks dataset card → Sees error: "Salesforce authentication expired"
7. Clicks "Reconnect to Salesforce"
8. Re-authenticates
9. Clicks "Try Syncing Again"
10. Success: "Donor Database synced 456 records"

**Key UX Wins:**
- Managed two distinct data flows without confusion
- Error message was actionable (not "API key invalid")
- Quick resolution (no engineering required)

### Scenario 3: Enterprise Museum (Enterprise Tier)
**Goal:** Complex multi-destination flow for collections data

**User Journey:**
1. Creates dataset: "Master Collections"
   - Source: CollectiveAccess
2. Adds multiple destinations:
   - Google Sheets (public website)
   - Airtable (internal research)
   - Custom API (mobile app)
3. Configures different field mappings per destination
4. Sets up incremental sync (only changed records)
5. Monitors via API:
   - GET /api/v1/datasets → See all datasets
   - GET /api/v1/datasets/{id} → Check sync status
6. Uses webhook to trigger custom workflow when sync completes

**Key UX Wins:**
- Single source → multiple destinations (no duplicate datasets)
- API access matches UI mental model (datasets, not routes)
- Flexible enough for advanced use cases

---

## Migration Path (From Current State)

### Current State (Connector-First)
- Users configure connectors separately from data flows
- Routes are separate objects linking connectors
- Runs are global, not contextual to datasets

### Transition Strategy
1. **Phase 1: UI Language Only** (this doc)
   - Rename labels: "Connectors" → "Connections" (settings page)
   - Rename "Routes" → "Flows" in nav
   - Update all run-related text to "sync"

2. **Phase 2: Dataset-Centric Views** (future sprint)
   - Redesign dataset detail page with flow visualization
   - Move connector config inline within dataset setup
   - Add Activity page (replaces Runs page)

3. **Phase 3: Data Model Refactor** (future sprint)
   - Embed connector config in dataset object
   - Deprecate separate routes table
   - Migrate existing routes → dataset.destinations

4. **Phase 4: New Setup Wizard** (future sprint)
   - Replace multi-page connector setup with inline wizard
   - Add data preview at each step
   - Streamline field mapping UI

### Backwards Compatibility
- API endpoints remain stable during transition
- Internal route_id preserved (mapped to dataset_id)
- Existing connector objects remain (behind the scenes)
- No breaking changes for API key users

---

## Success Metrics

### User Comprehension
- **Metric:** % of new users who complete dataset setup without support
- **Target:** 80% (up from current ~50%)
- **Measurement:** Track setup wizard abandonment rate

### Time to Value
- **Metric:** Time from signup to first successful sync
- **Target:** < 30 minutes (down from current ~2 hours)
- **Measurement:** Track time between account creation and first completed run

### Support Ticket Reduction
- **Metric:** % of tickets related to "how do I connect my data?"
- **Target:** 50% reduction
- **Measurement:** Tag tickets in support system

### User Satisfaction
- **Metric:** Post-setup survey: "How easy was it to connect your data?"
- **Target:** 4.5/5 (up from current 3.2/5)
- **Measurement:** In-app survey after first successful sync

---

## Appendix: UI Component Patterns

### Dataset Card (List View)
```
┌─────────────────────────────────────────────┐
│ Collections Objects              [✓ Active] │
│ PastPerfect → Google Sheets                 │
│                                             │
│ Last Sync: 2 hours ago | 1,234 records     │
│ Next Sync: in 22 hours                     │
└─────────────────────────────────────────────┘
```

### Dataset Card (Error State)
```
┌─────────────────────────────────────────────┐
│ Donor Records                    [! Error]  │
│ Salesforce → Airtable                       │
│                                             │
│ Sync failed: Salesforce authentication      │
│ [Reconnect] [View Details]                  │
└─────────────────────────────────────────────┘
```

### Flow Status Badge
```
[✓ Active]    Green, indicates healthy operation
[● Syncing]   Blue, animated, indicates in progress
[⚠ Warning]   Yellow, indicates partial success
[! Error]     Red, indicates failure
[❚❚ Paused]   Gray, indicates user-paused
```

### Activity Item
```
✓ Collections Objects synced 1,234 records
  2:00 AM • 45 seconds • 3 changes detected
  [View Details]
```

---

## Open Questions (For Team Discussion)

1. **Dataset Naming Conventions**
   - Should we enforce unique names within org?
   - Should we suggest naming patterns? (e.g., "System - Purpose")

2. **Multi-Source Datasets?**
   - Current spec: 1 source per dataset
   - Future: Could we merge multiple sources? (e.g., TMS + Excel → unified output)

3. **Dataset Templates**
   - Should we offer pre-built datasets? (e.g., "PastPerfect → Google Sheets starter")
   - Would this help onboarding or cause confusion?

4. **Branching Flows**
   - If a dataset has multiple destinations, how do we show conditional routing?
   - Example: "Send to Airtable if record.type = 'Artwork', else Google Sheets"

5. **Dataset Versioning**
   - Should we version dataset configurations?
   - Use case: "Restore yesterday's field mappings"

---

**Document Owner:** Product Team  
**Contributors:** Engineering, Design, Customer Success  
**Next Steps:**
1. Review with team (this week)
2. Create UI mockups based on this spec
3. Prioritize Phase 1 language changes (low-effort, high-impact)
4. Plan Phase 2 dataset-centric views (next quarter)

**Changelog:**
- 2026-01-06: Initial draft (v1.0)
