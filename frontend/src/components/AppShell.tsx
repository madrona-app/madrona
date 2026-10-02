import React, { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { SidebarProvider } from '../contexts/SidebarContext';
import { AgentChatProvider, useAgentChatContext } from '../contexts/AgentChatContext';
import { PageContextProvider } from '../contexts/PageContext';
import { usePageContextAutoDetect } from '../hooks/usePageContextAutoDetect';
import { useCommandPaletteShortcut } from '../hooks/useCommandPaletteShortcut';
import { useGuideActionable } from '../hooks/useGuideActionable';
import { useOnboardingSeen } from '../hooks/useOnboardingSeen';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useRecentPageTracker } from '../hooks/useRecentPageTracker';
import { AppSidebar } from './AppSidebar';
import { MinimalTopBar } from './MinimalTopBar';
import { MobileNavDrawer } from './navigation/MobileNavDrawer';
import { RoleOverrideBanner } from './RoleOverrideBanner';
import { Sparkles } from 'lucide-react';
import { useActiveProduct } from '../hooks/useActiveProduct';

// AgentChatPanel pulls react-markdown (~200 kB gzipped) via AgentMessage.
// Keep it off the critical authed boot path — only load when the user
// actually opens the chat. The floating button stays eager (just an icon).
const AgentChatPanel = React.lazy(() =>
  import('./agent/AgentChatPanel').then((m) => ({ default: m.AgentChatPanel }))
);

// RecordSetStrip is a 569-line workspace filmstrip used only on Collections
// and Media pages. Keep it out of admin/bridge/guide/content boots, and out
// of the shared guards chunk entirely.
const RecordSetStrip = React.lazy(() =>
  import('./record-detail/RecordSetStrip').then((m) => ({ default: m.RecordSetStrip }))
);

// Command palette — lazy so its ~4 kB of matching + row rendering code
// doesn't ship until the user actually presses Cmd+K the first time.
const CommandPalette = React.lazy(() =>
  import('./palette/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);

// Guide welcome — lazy because first-run onboarding has zero value for
// returning users and we don't want it in the critical boot chunk.
const GuideOnboardingWelcome = React.lazy(() =>
  import('./onboarding/GuideOnboardingWelcome').then((m) => ({
    default: m.GuideOnboardingWelcome,
  }))
);

interface AppShellContentProps {
  children: React.ReactNode;
}

function AppShellContent({ children }: AppShellContentProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const auth = useAuth();
  const { activeOrganizationId, isAuthenticated, hasAppAccess, user } = auth;
  const { isConnected } = useWebSocket();
  const effectiveOrgId = orgId || activeOrganizationId;
  const { isOpen: isChatOpen, openChat, closeChat } = useAgentChatContext();
  const hasGuideApp = hasAppAccess('guide');
  const { activeProductId } = useActiveProduct();
  const stripProductActive = activeProductId === 'collections' || activeProductId === 'media';

  // Sticky mount: the chat panel chunk downloads the first time the user
  // opens chat, then stays mounted so slide-out animation and in-flight
  // streaming from useAgentChat survive close/reopen cycles.
  const [chatHasOpened, setChatHasOpened] = React.useState(false);
  React.useEffect(() => {
    if (isChatOpen && !chatHasOpened) setChatHasOpened(true);
  }, [isChatOpen, chatHasOpened]);

  // Cmd+K command palette — same sticky-mount strategy as chat.
  const [isPaletteOpen, setIsPaletteOpen] = React.useState(false);
  const [paletteHasOpened, setPaletteHasOpened] = React.useState(false);
  const togglePalette = React.useCallback(() => {
    setIsPaletteOpen((prev) => {
      const next = !prev;
      if (next) setPaletteHasOpened(true);
      return next;
    });
  }, []);
  const closePalette = React.useCallback(() => setIsPaletteOpen(false), []);
  useCommandPaletteShortcut(togglePalette);

  // Proactive nudge: pulse the FAB when the current page has concrete
  // Guide-actionable state.
  const { actionable: guideActionable, reason: guideActionReason } =
    useGuideActionable();

  // First-run Guide onboarding. Only shown to users with Guide app access,
  // once per {userId × orgId}, and never while the chat panel is already
  // open (so we don't stack dialogs on top of an in-progress conversation).
  const { seen: onboardingSeen, markSeen: markOnboardingSeen } =
    useOnboardingSeen(user?.user_id, effectiveOrgId);
  const showOnboarding =
    isAuthenticated &&
    hasGuideApp &&
    !!effectiveOrgId &&
    !onboardingSeen &&
    !isChatOpen;

  // Auto-track recent page visits
  useRecentPageTracker();

  // Keep PageContext's route/product/navItemId in sync with the URL so the
  // Guide agent sees the live page on every chat turn.
  usePageContextAutoDetect();

  return (
    <div className="app-shell">
      {/* Sidebar - hidden on mobile, visible on tablet+ */}
      <AppSidebar orgId={effectiveOrgId} />

      {/* Mobile navigation drawer */}
      <MobileNavDrawer orgId={effectiveOrgId} />

      {/* Main content area */}
      <div className="app-shell-main">
        {/* Role override banner — inside app-shell-main so it appears at top of content */}
        <RoleOverrideBanner mode="banner" />

        {/* Minimal top bar - shows hamburger on mobile */}
        <MinimalTopBar />

        {/* WebSocket disconnect indicator */}
        {isAuthenticated && !isConnected && (
          <div
            className="bg-semantic-warning/10 text-semantic-warning text-sm px-4 py-2 text-center"
            role="status"
          >
            Connection lost. Reconnecting…
          </div>
        )}

        {/* Skip link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-16 focus-visible:left-2 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:bg-parchment focus-visible:text-ink focus-visible:rounded focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          Skip to main content
        </a>

        {/* Main content */}
        <main id="main-content" className="app-shell-content">
          <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            <div className="px-4 py-6 sm:px-0">{children}</div>
          </div>
        </main>

      </div>

      {/* Record Set Strip — workspace filmstrip, only relevant on Collections
          and Media pages. Gated by active product so the module doesn't
          download (and its polling queries don't run) on admin/bridge/guide/
          content pages. */}
      {stripProductActive && (
        <Suspense fallback={null}>
          <RecordSetStrip />
        </Suspense>
      )}

      {/* Ask Guide floating button.
          Always available to every authenticated user with an org —
          the lite chat is part of base Madrona, not gated on the
          Guide Studio subscription. The subscription gate moves
          inside the chat backend (orchestration tools — delegation,
          plans, drafts — only fire for orgs with hasGuideApp).
          Onboarding + the playground routes still gate on the
          subscription separately below. */}
      {/* No agent configured (AGENT_ENABLED=false) means no Guide at all:
          the backend omits it from `applications` and we render no
          Ask-Guide affordance, rather than a button that leads to an
          error page. */}
      {effectiveOrgId && !isChatOpen && auth.user?.agent_enabled !== false && (
        <div className="ask-guide-fab fixed right-6 z-40">
          {/* Actionable-state halo: an absolute-positioned ping layer
              behind the button so the FAB itself never scales and
              keyboard focus rings stay intact. The copper tint + slow
              3s ping keeps total screen time well under the 5% copper
              budget in the design system. */}
          {guideActionable && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-copper/40 animate-ping [animation-duration:3s]"
            />
          )}
          <button
            onClick={openChat}
            className={`relative flex items-center justify-center w-14 h-14 rounded-full bg-bark text-parchment shadow-lg hover:bg-copper-dark transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
              guideActionable ? 'ring-2 ring-copper/60 ring-offset-2 ring-offset-parchment' : ''
            }`}
            aria-label={guideActionReason ? `Ask Guide — ${guideActionReason}` : 'Ask Guide'}
            title={guideActionReason ? `Ask Guide — ${guideActionReason}` : 'Ask Guide'}
          >
            <Sparkles size={24} />
          </button>
        </div>
      )}

      {/* AI Agent chat panel — sticky lazy: chunk downloads on first open,
          then stays mounted so slide-out + streaming state survive toggles. */}
      {effectiveOrgId && chatHasOpened && (
        <Suspense fallback={null}>
          <AgentChatPanel
            isOpen={isChatOpen}
            onClose={closeChat}
            organizationId={effectiveOrgId}
          />
        </Suspense>
      )}

      {/* Cmd+K palette — sticky lazy for the same reason. */}
      {paletteHasOpened && (
        <Suspense fallback={null}>
          <CommandPalette isOpen={isPaletteOpen} onClose={closePalette} />
        </Suspense>
      )}

      {/* First-run Guide welcome — only mounted when it should actually
          show, so the chunk never downloads for returning users. */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <GuideOnboardingWelcome isOpen onDismiss={markOnboardingSeen} />
        </Suspense>
      )}
      {/* Role override — outside app-shell-main stacking context */}
      <RoleOverrideBanner mode="button" />
    </div>
  );
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <PageContextProvider>
        <AgentChatProvider>
          <AppShellContent>{children}</AppShellContent>
        </AgentChatProvider>
      </PageContextProvider>
    </SidebarProvider>
  );
}
