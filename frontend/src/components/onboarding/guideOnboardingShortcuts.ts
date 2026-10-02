/**
 * First-run welcome shortcuts. Each entry is a "what are you trying to do
 * today?" option that hands a pre-filled query to Guide — Guide resolves
 * it via `navigate_to` and (where relevant) follow-up lookups, then
 * renders a one-click destination button in the chat reply.
 *
 * Prompts are phrased as a user asking Guide in the first person so the
 * language model stays in the expected conversational mode. Keep the list
 * small (≤6) so the welcome screen stays scannable.
 */

import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  PackageOpen,
  Download,
  Upload,
  ClipboardCheck,
  Hammer,
} from 'lucide-react';

export interface OnboardingShortcut {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
}

export const GUIDE_ONBOARDING_SHORTCUTS: OnboardingShortcut[] = [
  {
    id: 'catalog-object',
    icon: BookOpen,
    label: 'Catalog a new object',
    description: 'Create a collection object record and fill in the required fields',
    prompt:
      "I want to catalog a new object. Where do I start, and what are the essential fields I need to fill in to catalog it properly?",
  },
  {
    id: 'receive-entry',
    icon: PackageOpen,
    label: 'Receive an incoming delivery',
    description: 'Record an object entry and start the acquisition workflow',
    prompt:
      "I just received an incoming delivery of objects. How do I record an object entry and what happens next in the acquisition workflow?",
  },
  {
    id: 'loan-in',
    icon: Download,
    label: 'Process an incoming loan',
    description: 'Borrow objects from another institution',
    prompt:
      "I need to process an incoming loan from another institution. Walk me through the steps and take me to the right page.",
  },
  {
    id: 'loan-out',
    icon: Upload,
    label: 'Send an outgoing loan',
    description: 'Lend objects to another institution or venue',
    prompt:
      "I need to prepare an outgoing loan. What do I need to do, and where in the app do I start?",
  },
  {
    id: 'condition-report',
    icon: ClipboardCheck,
    label: 'File a condition report',
    description: 'Document the current condition of an object',
    prompt:
      "I want to file a new condition report for an object. Take me to the right page and explain the fields I need to fill in.",
  },
  {
    id: 'conservation',
    icon: Hammer,
    label: 'Start a conservation treatment',
    description: 'Record planned or in-progress conservation work',
    prompt:
      "I want to start a conservation treatment record. Where do I go, and what are the phases of a treatment workflow?",
  },
];
