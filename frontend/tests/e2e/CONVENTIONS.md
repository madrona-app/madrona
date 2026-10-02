# E2E Test Conventions

Patterns that work in this codebase. Follow these to keep specs stable.

## Locator strategy (priority order)

1. **Exact accessible name** — `getByRole('button', { name: 'Create Acquisition' })`
   Not regex when there's only one match. Regex overmatch (`/create|save/i`) causes strict mode violations when multiple buttons partially match.

2. **Heading + URL assertions** — `getByRole('heading', { name: /acquisitions/i })` and `toHaveURL()`
   More stable than button-state or toast assertions. Pages can change button labels; headings and URLs rarely change.

3. **Specific placeholder text** — `getByPlaceholder('Search loans...')`
   Each list page has a unique placeholder. Don't use generic `/search/i` — it can match sidebar, nav, or header elements.

4. **CSS locators (last resort)** — `page.locator('.space-y-1\\.5 input[type="text"]')`
   Only when the component lacks accessible wiring (no `htmlFor`, no `aria-label`, label doesn't wrap input). Flag these as product debt.

## Timing

- **Always use bounded waits.** `waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})` — never omit the timeout. WebSocket connections prevent `networkidle` from resolving.
- **Don't assert immediately after navigation.** Add `waitForLoadState` before heading/content assertions. Parallel test workers make initial page loads slower.
- **Use `waitForTimeout` sparingly and only for debounce/animation settling** (300-1000ms). Never as a substitute for a proper wait condition.

## Assertions

- **List page:** heading visible, create button/link visible, search placeholder visible.
- **Detail/workspace page:** heading visible, at least one section rendered, no `[data-testid="error-boundary"]`.
- **Form/create page:** submit button visible, at least one form section visible.
- **After create:** assert URL changed away from `/create` or `/new`. Don't rely on toast visibility — some create flows redirect without a toast.
- **Validation:** assert page stays on create URL OR error text is visible. Don't assume specific error message wording.

## Known component limitations

### EditableField (workspace sections)
`<label>` and `<input>` are siblings, not parent/child. No `htmlFor`/`id` association.
`getByLabel()` will not find the input. Use CSS locator to find input near the label text.
**This is product debt** — adding `htmlFor` to EditableField would fix it for both tests and screen readers.

### Workspace section expand
Create pages render sections collapsed. Tests must click the section header to expand before filling fields.
The section header is a clickable div/button with the section name as text content.

### Custom modals
Admin pages use custom overlay modals, not native `<dialog>` or `role="dialog"`.
Don't use `getByRole('dialog')`. Instead, assert on the modal's heading: `getByRole('heading', { name: /invite user/i })`.

## Button text reference

| Page | Create button | Button type |
|------|--------------|-------------|
| Objects list | "New Object" | link |
| Objects create | "Create Object" | button |
| Acquisitions list | "New Acquisition" | link |
| Acquisitions create | "Create Acquisition" | button |
| Loans In list | "New Incoming Loan" | link |
| Loans Out list | "New Outgoing Loan" | link |
| Loans create | "Create Loan" | button |
| Events list | "Create Event" | link |
| Events create | "Create Event" | button |
| Entries list | "New Entry" | link |
| Users list | "Invite User" | button |

## Running tests

```bash
# All journeys
npx playwright test tests/e2e/specs/journeys/ --project=chromium

# All fault injection
npx playwright test tests/e2e/specs/fault/ --project=chromium

# Smoke (all routes)
npx playwright test tests/e2e/specs/pages/smoke.spec.ts --project=chromium

# Touch every button (all three specs)
pnpm test:buttons

# Buttons on list/nav pages only
pnpm test:buttons:list

# Buttons on workspace/detail pages (needs test data)
pnpm test:buttons:workspace

# Non-button interactives (tabs, selects, menus, role=button)
pnpm test:buttons:interactive

# Single product (e.g. only collections buttons)
npx playwright test all-buttons.spec.ts -g "collections" --project=chromium

# Single workspace (e.g. only Loans In)
npx playwright test workspace-buttons.spec.ts -g "Loans In" --project=chromium

# Single spec
npx playwright test tests/e2e/specs/journeys/entries.spec.ts --project=chromium
```

## Full test suite

```bash
# Everything in specs/pages/ (buttons, render, contracts, smoke)
pnpm test:all

# Sentry deploy gate (blocks if unresolved errors exist)
pnpm sentry:gate          # last 1 hour
pnpm sentry:gate:4h       # last 4 hours

# Render stability (catches race-condition crashes)
pnpm test:render

# API contract validation (catches schema drift)
pnpm test:contracts              # validate against recorded responses
pnpm test:contracts:record       # record fresh responses from live backend
```

## Button test failure modes

The button test specs (`all-buttons`, `workspace-buttons`, `interactive-elements`) fail **hard** on:
- JS exceptions thrown after any click
- React error boundary appearing after any click
- 5xx API response triggered by any click

They log but do **not** fail on:
- Console errors (often noisy, not always bugs)
- 4xx API responses (may be permission-gated)
- Click failures (button behind overlay — logged as `click-failed`)

To investigate a failure, run with `--debug` to step through, or check the HTML report (`pnpm test:e2e:report`).
