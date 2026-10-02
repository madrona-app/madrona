import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcedureComplianceCard } from '../../components/collections/ProcedureComplianceCard';
import type { RequirementGroup } from '../../lib/procedureComplianceUtils';

const REQUIREMENT_GROUPS: RequirementGroup[] = [
  {
    id: 'identification',
    label: 'Identification',
    sectionId: 'identification',
    requirements: [
      {
        id: 'req-name',
        label: 'Object name',
        groupId: 'identification',
        fieldPaths: ['object_name'],
        requiredForStatuses: ['received', 'processed'],
        severity: 'blocking',
      },
      {
        id: 'req-number',
        label: 'Object number',
        groupId: 'identification',
        fieldPaths: ['object_number'],
        requiredForStatuses: ['processed'],
        severity: 'blocking',
      },
    ],
  },
  {
    id: 'acquisition',
    label: 'Acquisition',
    sectionId: 'acquisition',
    requirements: [
      {
        id: 'req-method',
        label: 'Acquisition method',
        groupId: 'acquisition',
        fieldPaths: ['acquisition_method'],
        requiredForStatuses: ['processed'],
        severity: 'blocking',
      },
    ],
  },
];

const STATUS_ORDER = ['draft', 'received', 'processed'];

function renderCard(props: Partial<Parameters<typeof ProcedureComplianceCard>[0]> = {}) {
  return render(
    <ProcedureComplianceCard
      entry={{}}
      currentStatus="received"
      requirementGroups={REQUIREMENT_GROUPS}
      statusOrder={STATUS_ORDER}
      onSectionNavigate={vi.fn()}
      {...props}
    />,
  );
}

describe('ProcedureComplianceCard', () => {
  it('uses the default title', () => {
    renderCard();
    expect(screen.getByText('Procedure Compliance')).toBeInTheDocument();
  });

  it('uses a custom title when provided', () => {
    renderCard({ title: 'Loan Compliance' });
    expect(screen.getByText('Loan Compliance')).toBeInTheDocument();
  });

  it('shows the missing-fields summary when fields are blank', () => {
    renderCard();
    expect(screen.getByText(/Missing required fields/)).toBeInTheDocument();
  });

  it('shows "All required fields complete" when 100%', () => {
    renderCard({ entry: { object_name: 'Vase', object_number: '2024.1', acquisition_method: 'gift' } });
    expect(screen.getByText('All required fields complete')).toBeInTheDocument();
  });

  it('starts collapsed by default', () => {
    renderCard();
    expect(screen.queryByText('Identification')).not.toBeInTheDocument();
  });

  it('expands when the header is clicked', () => {
    renderCard();
    fireEvent.click(screen.getByText('Procedure Compliance'));
    expect(screen.getByText('Identification')).toBeInTheDocument();
    expect(screen.getByText('Acquisition')).toBeInTheDocument();
  });

  it('starts expanded when defaultExpanded is true', () => {
    renderCard({ defaultExpanded: true });
    expect(screen.getByText('Identification')).toBeInTheDocument();
  });

  it('renders the "Fix next blocking requirement" button when expanded with blockers', () => {
    renderCard({ defaultExpanded: true });
    expect(screen.getByText('Fix next blocking requirement')).toBeInTheDocument();
  });

  it('omits the Fix-next button when nothing is blocking', () => {
    renderCard({
      defaultExpanded: true,
      entry: { object_name: 'Vase', object_number: '2024.1', acquisition_method: 'gift' },
    });
    expect(screen.queryByText('Fix next blocking requirement')).not.toBeInTheDocument();
  });

  it('clicks Fix-next and routes navigation to the first missing field', () => {
    const onSectionNavigate = vi.fn();
    renderCard({ defaultExpanded: true, onSectionNavigate });
    fireEvent.click(screen.getByText('Fix next blocking requirement'));
    expect(onSectionNavigate).toHaveBeenCalledWith('identification', 'object_name');
  });

  it('navigates to a group when clicked in the checklist', () => {
    const onSectionNavigate = vi.fn();
    renderCard({ defaultExpanded: true, onSectionNavigate });
    fireEvent.click(screen.getByText('Acquisition'));
    expect(onSectionNavigate).toHaveBeenCalledWith('acquisition', 'acquisition_method');
  });

  it('also calls optional onFixNext when the Fix-next button is clicked', () => {
    const onFixNext = vi.fn();
    renderCard({ defaultExpanded: true, onFixNext });
    fireEvent.click(screen.getByText('Fix next blocking requirement'));
    expect(onFixNext).toHaveBeenCalledTimes(1);
  });

  it('renders an external standard link in the footer', () => {
    renderCard({ defaultExpanded: true });
    const link = screen.getByText('View standard').closest('a');
    expect(link).toHaveAttribute('href', 'https://collectionstrust.org.uk/procedure/');
  });

  it('reports completion fraction in the header', () => {
    renderCard({ entry: { object_name: 'Vase' } });
    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
  });
});
