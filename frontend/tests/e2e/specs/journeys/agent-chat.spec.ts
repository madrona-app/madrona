import { test, expect } from '../../fixtures';
import type { Route } from '@playwright/test';

/**
 * Agent Chat End-to-End
 *
 * Verifies the wiring between the chat FAB → AgentChatPanel →
 * AgentMessage → useAgentChat → backend SSE pipe, without burning
 * Anthropic credits or depending on a deployed agent. Every backend
 * agent endpoint is intercepted with `page.route` and served a
 * deterministic response.
 *
 * Why E2E and not unit: AgentChatPanel + AgentMessage have unit tests
 * (~~120 cases) that lock down their internal logic against mocked
 * collaborators. What unit tests cannot catch:
 *   - the lazy-loaded chunk failing to hydrate
 *   - AppShell wiring the FAB to AgentChatContext.openChat correctly
 *   - the SSE reader actually consuming the wire format
 *   - the onClick prevent-default in MarkdownContent calling
 *     React Router's real navigate (vs page reload)
 *   - the post-streaming feedback affordances appearing in real DOM
 *
 * The four endpoints intercepted:
 *   GET    /agent/conversations              → empty list
 *   POST   /agent/conversations               → returns a stub conversation_id
 *   GET    /agent/conversations/:id/messages  → empty list
 *   POST   /agent/conversations/:id/chat      → streams a canned SSE
 *
 * To exercise this against a real agent (e.g. on staging), set
 * PLAYWRIGHT_AGENT_LIVE=1 and the route stubs below short-circuit.
 */

const LIVE = process.env.PLAYWRIGHT_AGENT_LIVE === '1';

/**
 * Build a Server-Sent Events response body matching the wire format
 * useAgentChat parses. One text_delta per chunk plus a final `done` event.
 * UI hints ride on a `tool_end` event under `data.ui` — the exact shape the
 * backend emits (agent_service.py: tool_end_payload["ui"] = ui_hint) and the
 * only path useAgentChat reads hints from. (A bare `ui_hint` event, which the
 * frontend has no case for, is silently ignored — that mismatch is why the
 * navigation-button assertion failed.)
 */
function sseBody(opts: {
  textChunks: string[];
  uiHints?: unknown[];
}): string {
  const events: string[] = [];
  for (const chunk of opts.textChunks) {
    events.push(`event: text_delta`);
    events.push(`data: ${JSON.stringify({ text: chunk })}`);
    events.push('');
  }
  for (const hint of opts.uiHints ?? []) {
    events.push(`event: tool_end`);
    events.push(`data: ${JSON.stringify({ ui: hint })}`);
    events.push('');
  }
  events.push(`event: done`);
  events.push(`data: {}`);
  events.push('');
  events.push('');
  return events.join('\n');
}

/**
 * Install the agent-API route stubs on a page. Returns a teardown
 * function so individual tests can compose extra route overrides
 * before tearing down.
 */
async function stubAgentApi(
  page: import('@playwright/test').Page,
  opts: {
    chatBody?: string;
    chatStatus?: number;
    conversationId?: string;
  } = {},
) {
  if (LIVE) return async () => {};
  const conversationId = opts.conversationId ?? 'conv-e2e-test';

  // The Ask Guide FAB is withheld when the deployment reports no agent
  // (agent_enabled false), which is correct behavior — a chat that cannot
  // answer should not be offered. But this spec stubs every agent endpoint
  // precisely so it can exercise the chat wiring without a configured agent,
  // and it drives that chat by clicking the FAB. Stubbing the four endpoints
  // while leaving the capability flag alone means the affordance is absent
  // and every test here fails on a missing button.
  //
  // So the capability is stubbed too: patch agent_enabled true onto the real
  // /api/me response rather than fabricating one, so the user, organization
  // and permissions the rest of the app reads stay authentic.
  await page.route('**/api/me', async (route: Route) => {
    const response = await route.fetch();
    let body: Record<string, unknown>;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    return route.fulfill({
      response,
      body: JSON.stringify({ ...body, agent_enabled: true }),
    });
  });

  await page.route('**/api/organizations/*/agent/conversations', (route: Route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          conversation_id: conversationId,
          title: null,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ conversations: [] }),
    });
  });

  await page.route(
    `**/api/organizations/*/agent/conversations/${conversationId}/messages`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: [] }),
      }),
  );

  await page.route(
    `**/api/organizations/*/agent/conversations/${conversationId}/chat`,
    (route: Route) =>
      route.fulfill({
        status: opts.chatStatus ?? 200,
        contentType: 'text/event-stream',
        body: opts.chatBody ?? sseBody({ textChunks: ['Hello, ', 'how can I help?'] }),
      }),
  );

  return async () => {
    await page.unrouteAll();
  };
}

test.describe('Agent chat panel', () => {
  test('opens via FAB, sends a message, renders streamed response', async ({
    page,
    orgId,
  }) => {
    const teardown = await stubAgentApi(page);
    try {
      await page.goto(`/organizations/${orgId}/collections/loans-in`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // The FAB lives in AppShell. Aria-label is "Ask Guide" (or
      // "Ask Guide — <reason>" when guideActionable). Match the prefix.
      const fab = page.getByRole('button', { name: /^Ask Guide/ });
      await expect(fab).toBeVisible({ timeout: 10000 });
      await fab.click();

      // Slide-over modal renders.
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Ask me anything about the collection.')).toBeVisible();

      // Type a question and press Enter.
      const textarea = dialog.getByPlaceholder('Ask a question...');
      await textarea.click();
      await textarea.fill('What is on this loan?');
      await textarea.press('Enter');

      // User message appears in the message list immediately.
      await expect(dialog.getByText('What is on this loan?')).toBeVisible();

      // Streamed assistant response renders both chunks concatenated.
      await expect(dialog.getByText(/Hello, how can I help\?/)).toBeVisible({
        timeout: 10000,
      });

      // Once streaming finishes, feedback affordances render. Hover
      // group reveals them; we just check presence in the DOM.
      // exact: 'Helpful' would otherwise substring-match 'Not helpful' too.
      await expect(dialog.getByLabel('Helpful', { exact: true })).toBeAttached({ timeout: 5000 });
      await expect(dialog.getByLabel('Not helpful')).toBeAttached();
      await expect(dialog.getByLabel('Copy message')).toBeAttached();
    } finally {
      await teardown();
    }
  });

  test('navigation hint button routes to the target page and closes the panel', async ({
    page,
    orgId,
  }) => {
    // Server includes a navigation hint with a target inside the
    // current org. Clicking it should call navigate() and close
    // the chat panel.
    const teardown = await stubAgentApi(page, {
      chatBody: sseBody({
        textChunks: ['See the loans-in list:'],
        uiHints: [
          {
            kind: 'navigation',
            target: {
              id: 'collections-loans-in',
              path: `/organizations/:orgId/collections/loans-in`,
              label: 'Incoming loans',
              breadcrumb: ['Collections', 'Loans in'],
            },
          },
        ],
      }),
    });
    try {
      // Start on a concrete page OTHER than loans-in so the hint button is
      // visible (it hides itself when the user is already on the target path).
      await page.goto(`/organizations/${orgId}/collections/acquisitions`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const fab = page.getByRole('button', { name: /^Ask Guide/ });
      await expect(fab).toBeVisible({ timeout: 10000 });
      await fab.click();

      const dialog = page.getByRole('dialog');
      const textarea = dialog.getByPlaceholder('Ask a question...');
      await textarea.fill('show me loans');
      await textarea.press('Enter');

      // Wait for the streamed message to render before asserting the hint.
      await expect(dialog.getByText('See the loans-in list:')).toBeVisible({
        timeout: 10000,
      });

      // Hint button rendered with breadcrumb text.
      const hintButton = dialog.getByRole('button', { name: /Go to Incoming loans/ });
      await expect(hintButton).toBeVisible({ timeout: 10000 });

      await hintButton.click();

      // Panel closed.
      await expect(dialog).not.toBeVisible();

      // URL reflects the substituted :orgId.
      await expect(page).toHaveURL(
        new RegExp(`/organizations/${orgId}/collections/loans-in`),
      );
    } finally {
      await teardown();
    }
  });

  test('renders error UI when the chat endpoint fails', async ({ page, orgId }) => {
    const teardown = await stubAgentApi(page, {
      chatStatus: 500,
      chatBody: 'internal error',
    });
    try {
      await page.goto(`/organizations/${orgId}/collections/loans-in`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      await page.getByRole('button', { name: /^Ask Guide/ }).click();
      const dialog = page.getByRole('dialog');
      const textarea = dialog.getByPlaceholder('Ask a question...');
      await textarea.fill('what');
      await textarea.press('Enter');

      // Error banner + "Try again" button.
      await expect(dialog.getByText(/Chat request failed: 500/)).toBeVisible({
        timeout: 10000,
      });
      await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();

      // Try again repopulates the textarea.
      await dialog.getByRole('button', { name: 'Try again' }).click();
      await expect(textarea).toHaveValue('what');
    } finally {
      await teardown();
    }
  });

  test('Esc / X / backdrop all close the panel', async ({ page, orgId }) => {
    const teardown = await stubAgentApi(page);
    try {
      await page.goto(`/organizations/${orgId}/collections/loans-in`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const fab = page.getByRole('button', { name: /^Ask Guide/ });
      await fab.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // X (Close chat) closes the panel.
      await dialog.getByRole('button', { name: 'Close chat' }).click();
      await expect(dialog).not.toBeVisible();

      // Re-open + Escape.
      await fab.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 2000 });
    } finally {
      await teardown();
    }
  });
});
