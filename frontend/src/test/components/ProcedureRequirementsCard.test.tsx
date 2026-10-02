import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcedureRequirementsCard } from '../../components/collections/ProcedureRequirementsCard';
import type { RequirementGroup } from '../../lib/procedureComplianceUtils';
import { computeProcedureCompliance } from '../../lib/procedureComplianceUtils';

// Mock AgentChatContext — card uses useAgentChatContext to dispatch chat prompts
vi.mock('../../contexts/AgentChatContext', () => ({
  useAgentChatContext: () => ({
    isOpen: false,
    entityContext: null,
    openChat: vi.fn(),
    closeChat: vi.fn(),
    setEntityContext: vi.fn(),
    openChatWithMessage: vi.fn(),
    registerDispatch: vi.fn(),
  }),
}));

// Mock the compliance utility to have deterministic output
vi.mock('../../lib/procedureComplianceUtils', () => ({
  computeProcedureCompliance: vi.fn(() => ({
    requiredTotal: 4,
    requiredComplete: 2,
    percentComplete: 50,
    blockingMissing: [
      {
        requirement: { id: 'r1', label: 'Depositor name', groupId: 'identification', fieldPaths: ['depositor_name'], requiredForStatuses: ['approved'], severity: 'blocking' },
        satisfied: false,
        missingFields: ['depositor_name'],
      },
    ],
    groups: [
      {
        group: { id: 'identification', label: 'Identification', sectionId: 'identification', requirements: [] },
        completedCount: 1,
        totalCount: 2,
        results: [
          { requirement: { id: 'r1', label: 'Depositor name' }, satisfied: false, missingFields: ['depositor_name'] },
          { requirement: { id: 'r2', label: 'Entry date' }, satisfied: true, missingFields: [] },
        ],
        blockingMissing: [
          { requirement: { id: 'r1', label: 'Depositor name' }, satisfied: false, missingFields: ['depositor_name'] },
        ],
        missingLabels: ['Depositor name'],
      },
      {
        group: { id: 'details', label: 'Details', sectionId: 'details', requirements: [] },
        completedCount: 1,
        totalCount: 2,
        results: [
          { requirement: { id: 'r3', label: 'Terms agreed' }, satisfied: true, missingFields: [] },
          { requirement: { id: 'r4', label: 'Notes' }, satisfied: false, missingFields: ['notes'] },
        ],
        blockingMissing: [],
        missingLabels: ['Notes'],
      },
    ],
    nextBlockingField: { sectionId: 'identification', fieldPath: 'depositor_name' },
  })),
}));

const requirementGroups: RequirementGroup[] = [
  {
    id: 'identification',
    label: 'Identification',
    sectionId: 'identification',
    requirements: [
      { id: 'r1', label: 'Depositor name', groupId: 'identification', fieldPaths: ['depositor_name'], requiredForStatuses: ['approved'], severity: 'blocking' },
      { id: 'r2', label: 'Entry date', groupId: 'identification', fieldPaths: ['entry_date'], requiredForStatuses: ['approved'], severity: 'blocking' },
    ],
  },
  {
    id: 'details',
    label: 'Details',
    sectionId: 'details',
    requirements: [
      { id: 'r3', label: 'Terms agreed', groupId: 'details', fieldPaths: ['terms_agreed'], requiredForStatuses: ['approved'], severity: 'blocking' },
      { id: 'r4', label: 'Notes', groupId: 'details', fieldPaths: ['notes'], requiredForStatuses: ['approved'], severity: 'recommended' },
    ],
  },
];

const defaultProps = {
  title: 'Entry Requirements',
  requirementGroups,
  record: { depositor_name: '', entry_date: '2026-01-01', terms_agreed: true, notes: '' },
  currentStatus: 'new',
  statusOrder: ['new', 'in_progress', 'approved', 'completed'],
  onSectionNavigate: vi.fn(),
};

describe('ProcedureRequirementsCard', () => {
  it('renders the title via RequirementsPanel', () => {
    render(<ProcedureRequirementsCard {...defaultProps} />);
    expect(screen.getByText('Entry Requirements')).toBeInTheDocument();
  });

  it('renders completion stats', () => {
    render(<ProcedureRequirementsCard {...defaultProps} />);
    expect(screen.getByText(/2\/4 \(50%\)/)).toBeInTheDocument();
  });

  it('renders blocking status message with enforcement disabled', () => {
    render(<ProcedureRequirementsCard {...defaultProps} />);
    expect(screen.getByText(/Advisory: Depositor name/)).toBeInTheDocument();
  });

  it('renders blocking status message with enforcement enabled', () => {
    render(<ProcedureRequirementsCard {...defaultProps} enforcementEnabled />);
    expect(screen.getByText(/Not ready: Depositor name/)).toBeInTheDocument();
  });

  it('renders rows when expanded', () => {
    render(<ProcedureRequirementsCard {...defaultProps} defaultExpanded />);
    expect(screen.getByText('Identification')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });

  it('calls onSectionNavigate when row is clicked', () => {
    const onSectionNavigate = vi.fn();
    render(<ProcedureRequirementsCard {...defaultProps} defaultExpanded onSectionNavigate={onSectionNavigate} />);
    fireEvent.click(screen.getByText('Identification'));
    expect(onSectionNavigate).toHaveBeenCalledWith('identification', 'depositor_name');
  });

  it('calls onSectionNavigate for fix blocker', () => {
    const onSectionNavigate = vi.fn();
    render(<ProcedureRequirementsCard {...defaultProps} onSectionNavigate={onSectionNavigate} />);
    const fixBtn = screen.getByText('Fix blocker');
    fireEvent.click(fixBtn);
    expect(onSectionNavigate).toHaveBeenCalledWith('identification', 'depositor_name');
  });

  it('renders ready message when all requirements are met', () => {
    // Override mock to return no blockers
    const mockedCompute = vi.mocked(computeProcedureCompliance);
    mockedCompute.mockReturnValueOnce({
      requiredTotal: 4,
      requiredComplete: 4,
      percentComplete: 100,
      blockingMissing: [],
      groups: [],
      nextBlockingField: null,
    });

    render(<ProcedureRequirementsCard {...defaultProps} />);
    expect(screen.getByText('Ready for next step')).toBeInTheDocument();
  });

  it('renders custom ready message', () => {
    const mockedCompute = vi.mocked(computeProcedureCompliance);
    mockedCompute.mockReturnValueOnce({
      requiredTotal: 4,
      requiredComplete: 4,
      percentComplete: 100,
      blockingMissing: [],
      groups: [],
      nextBlockingField: null,
    });

    render(<ProcedureRequirementsCard {...defaultProps} readyMessage="All clear!" />);
    expect(screen.getByText('All clear!')).toBeInTheDocument();
  });
});
