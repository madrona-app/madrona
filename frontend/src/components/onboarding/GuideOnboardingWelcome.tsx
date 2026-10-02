/**
 * GuideOnboardingWelcome — first-run "what are you trying to do today?"
 * picker. Shown once per {userId × orgId} in the lower-right corner of
 * the app shell, above the Ask Guide FAB, so the user's first impression
 * of the Guide is "here's a concrete thing it can do for me right now."
 *
 * Behavior:
 *   - Picking a shortcut hands its prompt to the Guide chat panel via
 *     `openChatWithMessage`; Guide auto-sends it on open, usually
 *     producing a navigate_to button in the first reply.
 *   - "Maybe later" or Esc dismisses without opening the chat. Either
 *     way the welcome is marked seen so it doesn't re-nag.
 *   - "Explore on my own" is the same dismissal but with friendlier copy.
 *
 * Not a full-screen modal on purpose. It's a panel that sits over the
 * app and can be ignored — forcing users through a dialog on first
 * login is invasive for experienced staff switching orgs.
 */

import { useCallback } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useAgentChatContext } from '../../contexts/AgentChatContext';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';
import {
  GUIDE_ONBOARDING_SHORTCUTS,
  type OnboardingShortcut,
} from './guideOnboardingShortcuts';

export interface GuideOnboardingWelcomeProps {
  isOpen: boolean;
  onDismiss: () => void;
}

export function GuideOnboardingWelcome({
  isOpen,
  onDismiss,
}: GuideOnboardingWelcomeProps) {
  const { openChatWithMessage } = useAgentChatContext();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose: onDismiss,
    titlePrefix: 'guide-onboarding',
  });

  const handleShortcutClick = useCallback(
    (shortcut: OnboardingShortcut) => {
      openChatWithMessage(shortcut.prompt);
      onDismiss();
    },
    [openChatWithMessage, onDismiss],
  );

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center pointer-events-none p-4 sm:p-6"
        aria-hidden="false"
      >
        {/* Light backdrop — not a hard modal, just a scrim to draw focus. */}
        <div
          className="absolute inset-0 bg-ink/20 pointer-events-auto"
          onClick={onDismiss}
          aria-hidden="true"
        />

        <div
          ref={modalRef}
          {...getModalAriaProps(titleId, descriptionId)}
          className="relative pointer-events-auto w-full max-w-lg rounded-lg bg-parchment shadow-2xl border border-lichen overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-lichen bg-stone/30">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex-shrink-0 mt-0.5">
                <Sparkles className="h-5 w-5 text-bark" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-semibold text-ink">
                  Welcome — what would you like help with?
                </h2>
                <p id={descriptionId} className="text-sm text-archive mt-1">
                  Pick a task below and Guide will take you there. You can
                  always open Guide later with the sparkle button in the
                  corner or Cmd+K.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="flex-shrink-0 -m-1 p-1 text-archive hover:text-ink hover:bg-stone rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30"
              aria-label="Dismiss welcome"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Shortcut grid */}
          <ul
            className="divide-y divide-lichen"
            aria-label="Onboarding task shortcuts"
          >
            {GUIDE_ONBOARDING_SHORTCUTS.map((shortcut) => {
              const Icon = shortcut.icon;
              return (
                <li key={shortcut.id}>
                  <button
                    type="button"
                    onClick={() => handleShortcutClick(shortcut)}
                    className="w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-bark/5 focus-visible:outline-none focus-visible:bg-bark/10 transition-colors"
                  >
                    <div className="flex-shrink-0 mt-0.5 text-bark">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">
                        {shortcut.label}
                      </div>
                      <div className="text-xs text-archive mt-0.5">
                        {shortcut.description}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-lichen flex items-center justify-between bg-stone/30">
            <p className="text-xs text-archive">
              Not sure? Type your question in Guide directly.
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-medium text-bark hover:text-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 rounded px-2 py-1"
            >
              Explore on my own
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
