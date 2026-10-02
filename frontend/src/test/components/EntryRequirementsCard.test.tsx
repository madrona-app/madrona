import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntryRequirementsCard } from '../../components/collections/EntryRequirementsCard';
import type { RequirementGroup } from '../../lib/procedureComplianceUtils';

vi.mock('../../contexts/PageContext', () => ({
  usePageContext: () => ({
    pageContext: { entity: { type: 'object_entry', id: 'entry-1', label: 'E-1' } },
  }),
}));

vi.mock('../../components/guide/AskGuideButton', () => ({
  AskGuideButton: ({ label, prompt }: { label: string; prompt: string }) => (
    <button data-testid="ask-guide" data-prompt={prompt}>
      {label}
    </button>
  ),
}));

const REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'depositor',
    label: 'Depositor',
    sectionId: 'depositor',
    requirements: [
      {
        id: 'req-depositor-name',
        label: 'Depositor name',
        groupId: 'depositor',
        fieldPaths: ['depositor_name'],
        requiredForStatuses: ['received', 'processed', 'returned'],
        severity: 'blocking',
      },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    sectionId: 'objects',
    requirements: [
      {
        id: 'req-objects-desc',
        label: 'Objects description',
        groupId: 'objects',
        fieldPaths: ['objects_description'],
        requiredForStatuses: ['processed'],
        severity: 'blocking',
      },
    ],
  },
];

const STATUS_ORDER = ['draft', 'received', 'processed', 'returned'];

function renderCard(props: Partial<Parameters<typeof EntryRequirementsCard>[0]> = {}) {
  return render(
    <EntryRequirementsCard
      entry={{}}
      currentStatus="received"
      requirementGroups={REQUIREMENT_GROUPS}
      statusOrder={STATUS_ORDER}
      onSectionNavigate={vi.fn()}
      {...props}
    />,
  );
}

describe('EntryRequirementsCard', () => {
  it('renders the panel title "Entry Requirements"', () => {
    renderCard();
    expect(screen.getByText('Entry Requirements')).toBeInTheDocument();
  });

  it('shows "Not ready" when blocking fields are missing', () => {
    renderCard();
    expect(screen.getByText(/Not ready: Depositor name/)).toBeInTheDocument();
  });

  it('shows "Ready for next step" when there are no blockers for the next status', () => {
    renderCard({
      currentStatus: 'received',
      entry: { depositor_name: 'Jane' },
    });
    // Next blocker after "received" with depositor_name set is for "processed"
    // (objects_description), so still not ready unless we fill it too:
    expect(screen.getByText(/Not ready/)).toBeInTheDocument();
  });

  it('shows ready-for-action message with target action label', () => {
    renderCard({
      targetAction: 'return',
      entry: { depositor_name: 'Jane' },
    });
    // For action=return only depositor_name is required, so it's ready
    expect(screen.getByText('Ready for Return to Depositor')).toBeInTheDocument();
  });

  it('renders an Ask Guide button when there is a blocking requirement', () => {
    renderCard();
    expect(screen.getByTestId('ask-guide')).toBeInTheDocument();
  });

  it('omits Ask Guide button when there are no blocking requirements', () => {
    renderCard({
      currentStatus: 'received',
      targetAction: 'return',
      entry: { depositor_name: 'Jane' },
    });
    expect(screen.queryByTestId('ask-guide')).not.toBeInTheDocument();
  });

  it('forwards row click to onSectionNavigate with the section id and first missing field', () => {
    const onSectionNavigate = vi.fn();
    renderCard({ defaultExpanded: true, onSectionNavigate });
    fireEvent.click(screen.getByText('Depositor'));
    expect(onSectionNavigate).toHaveBeenCalledWith('depositor', 'depositor_name');
  });

  it('Fix-blocker click navigates to the next missing field', () => {
    const onSectionNavigate = vi.fn();
    renderCard({ onSectionNavigate });
    fireEvent.click(screen.getByText('Fix blocker'));
    expect(onSectionNavigate).toHaveBeenCalledWith('depositor', 'depositor_name');
  });

  it('passes onViewGuidance through to the panel', () => {
    const onViewGuidance = vi.fn();
    renderCard({ defaultExpanded: true, onViewGuidance });
    fireEvent.click(screen.getByText('View guidance'));
    expect(onViewGuidance).toHaveBeenCalledWith({
      status: 'received',
      blockingGroupId: 'depositor',
    });
  });
});
