import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ConditionSection,
  RightsSection,
  AcquisitionSection,
  ValuationsSection,
  ProceduresSection,
  NagpraSection,
  PartsSection,
} from '../../../pages/collections/CollectionObjectWorkspacePage/AdminSections';
import { makeCollectionObject } from './fixtures';
import type { FormData } from '../../../pages/collections/CollectionObjectWorkspacePage/types';

vi.mock('../../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../components/collections/ConditionReportLinker', () => ({
  ConditionReportLinker: ({ objectId }: { objectId: string }) => (
    <div data-testid="condition-report-linker">object:{objectId}</div>
  ),
}));

vi.mock('../../../components/collections/ObjectRightsManager', () => ({
  ObjectRightsManager: ({ objectId, readOnly }: { objectId: string; readOnly?: boolean }) => (
    <div data-testid="rights-manager">object:{objectId}-readOnly:{String(readOnly)}</div>
  ),
}));

vi.mock('../../../components/collections/AcquisitionObjectLinker', () => ({
  ObjectAcquisitionSelector: ({ objectId }: { objectId: string }) => (
    <div data-testid="acquisition-selector">object:{objectId}</div>
  ),
}));

vi.mock('../../../components/collections/RelatedProcedures', () => ({
  RelatedProcedures: ({ objectId }: { objectId: string }) => (
    <div data-testid="related-procedures">object:{objectId}</div>
  ),
}));

vi.mock('../../../components/collections/ObjectPartsManager', () => ({
  ObjectPartsManager: ({ objectId, readOnly }: { objectId: string; readOnly?: boolean }) => (
    <div data-testid="parts-manager">object:{objectId}-readOnly:{String(readOnly)}</div>
  ),
}));

vi.mock('../../../components/collections/NagpraManager', () => ({
  NagpraManager: ({ objectId, readOnly }: { objectId: string; readOnly?: boolean }) => (
    <div data-testid="nagpra-manager">object:{objectId}-readOnly:{String(readOnly)}</div>
  ),
}));

vi.mock('../../../components/collections/ObjectFieldComponents', () => ({
  NameListField: ({ label, items }: { label: string; items: unknown[] }) => (
    <div data-testid={`namelist-${label.toLowerCase()}`}>
      {label}:{items?.length ?? 0}
    </div>
  ),
}));

const baseFormData = {
  completeness: 'complete',
  conservation_priority: '',
  salvage_priority: '',
  completeness_note: '',
  condition_note: '',
  next_condition_check_date: '',
  handling_requirements: '',
  hazards: [],
  environmental_requirements: null,
  provenance: '',
  object_history_note: '',
  usage: '',
  usage_note: '',
  associated_cultural_affinity: '',
  association_note: '',
  acquisition_method: '',
  acquisition_date: '',
  acquisition_source: '',
  credit_line: '',
  excavation_site: '',
  excavation_date: '',
  field_collection_number: '',
  provenance_structured: [],
  exhibition_history: [],
  publication_history: [],
} as unknown as FormData;

const baseProps = {
  orgId: 'org-1',
  objectId: 'obj-1',
  object: makeCollectionObject(),
  isEditing: false,
  isCreateMode: false,
  expandedSections: {
    condition: true,
    rights: true,
    acquisition: true,
    valuations: true,
    procedures: true,
    nagpra: true,
    parts: true,
  },
  toggleSection: vi.fn(),
  sectionRefs: { current: {} },
  getSectionOrder: () => 1,
  isEmpty: false,
  sectionSummaries: {},
  isRestricted: () => false,
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ConditionSection', () => {
  const props = {
    ...baseProps,
    formData: baseFormData,
    updateField: vi.fn(),
    handleFieldBlur: vi.fn(),
  };

  it('renders "Condition" as the title', () => {
    wrap(<ConditionSection {...props} />);
    expect(screen.getByText('Condition')).toBeInTheDocument();
  });

  it('renders the saved condition_note value in view mode', () => {
    wrap(
      <ConditionSection
        {...props}
        object={makeCollectionObject({ condition_note: 'Stable, minor crazing' })}
      />,
    );
    expect(screen.getByText('Stable, minor crazing')).toBeInTheDocument();
  });

  it('shows the linked ConditionReportLinker', () => {
    wrap(<ConditionSection {...props} />);
    expect(screen.getByTestId('condition-report-linker')).toHaveTextContent('object:obj-1');
  });
});

describe('RightsSection', () => {
  it('renders "Rights Management" title', () => {
    wrap(<RightsSection {...baseProps} />);
    expect(screen.getByText('Rights Management')).toBeInTheDocument();
  });

  it('passes readOnly=true to ObjectRightsManager when not editing', () => {
    wrap(<RightsSection {...baseProps} />);
    expect(screen.getByTestId('rights-manager')).toHaveTextContent('readOnly:true');
  });

  it('passes readOnly=false when editing', () => {
    wrap(<RightsSection {...baseProps} isEditing />);
    expect(screen.getByTestId('rights-manager')).toHaveTextContent('readOnly:false');
  });
});

describe('AcquisitionSection', () => {
  const props = {
    ...baseProps,
    formData: baseFormData,
    updateField: vi.fn(),
    handleFieldBlur: vi.fn(),
  };

  it('renders "Acquisition & Provenance" title', () => {
    wrap(<AcquisitionSection {...props} />);
    expect(screen.getByText('Acquisition & Provenance')).toBeInTheDocument();
  });

  it('renders the linked Acquisition selector when not in create mode', () => {
    wrap(<AcquisitionSection {...props} />);
    expect(screen.getByTestId('acquisition-selector')).toHaveTextContent('object:obj-123');
  });

  it('does not render the linked Acquisition selector in create mode', () => {
    wrap(<AcquisitionSection {...props} isCreateMode />);
    expect(screen.queryByTestId('acquisition-selector')).toBeNull();
  });

  it('renders saved provenance text in view mode', () => {
    wrap(
      <AcquisitionSection
        {...props}
        object={makeCollectionObject({ provenance: 'From the Smith Estate.' })}
      />,
    );
    expect(screen.getByText('From the Smith Estate.')).toBeInTheDocument();
  });
});

describe('ValuationsSection', () => {
  it('renders "Valuations" title', () => {
    wrap(<ValuationsSection {...baseProps} valuationsData={[]} />);
    expect(screen.getByText('Valuations')).toBeInTheDocument();
  });

  it('shows empty-state copy when there is no valuation data', () => {
    wrap(<ValuationsSection {...baseProps} valuationsData={[]} />);
    expect(screen.getByText('No valuations recorded')).toBeInTheDocument();
  });

  it('renders linked valuation cards as Links', () => {
    const valuationsData = [
      {
        valuation_id: 'v-1',
        valuation_amount: 5000,
        valuation_currency: 'USD',
        valuation_type: 'insurance',
        is_current: true,
      },
      {
        valuation_id: 'v-2',
        valuation_amount: 3000,
        valuation_currency: 'USD',
        valuation_type: 'market',
        is_current: false,
      },
    ];
    wrap(<ValuationsSection {...baseProps} valuationsData={valuationsData as never} />);
    expect(screen.getByText('insurance')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getAllByRole('link').length).toBe(2);
  });

  it('shows the valuation count badge when valuations exist', () => {
    const valuationsData = [
      {
        valuation_id: 'v-1',
        valuation_amount: 1,
        valuation_currency: 'USD',
        valuation_type: 'insurance',
        is_current: true,
      },
    ];
    wrap(
      <ValuationsSection
        {...baseProps}
        expandedSections={{ ...baseProps.expandedSections, valuations: false }}
        valuationsData={valuationsData as never}
      />,
    );
    expect(screen.getByText('1 valuations')).toBeInTheDocument();
  });

  it('renders an "Add Valuation" button when onAddValuation is provided', () => {
    const onAddValuation = vi.fn();
    wrap(
      <ValuationsSection
        {...baseProps}
        valuationsData={[]}
        onAddValuation={onAddValuation}
      />,
    );
    fireEvent.click(screen.getByText('Add Valuation'));
    expect(onAddValuation).toHaveBeenCalledTimes(1);
  });

  it('returns null when valuation_history is field-restricted', () => {
    const isRestricted = (field: string) => field === 'valuation_history';
    const { container } = wrap(
      <ValuationsSection
        {...baseProps}
        valuationsData={[]}
        isRestricted={isRestricted}
      />,
    );
    expect(container.querySelector('#section-valuations')).toBeNull();
  });
});

describe('ProceduresSection', () => {
  it('renders "Related Procedures" title', () => {
    wrap(<ProceduresSection {...baseProps} />);
    expect(screen.getByText('Related Procedures')).toBeInTheDocument();
  });

  it('renders RelatedProcedures with the right object id', () => {
    wrap(<ProceduresSection {...baseProps} />);
    expect(screen.getByTestId('related-procedures')).toHaveTextContent('object:obj-1');
  });
});

describe('NagpraSection', () => {
  it('renders "NAGPRA Compliance" title', () => {
    wrap(<NagpraSection {...baseProps} />);
    expect(screen.getByText('NAGPRA Compliance')).toBeInTheDocument();
  });

  it('passes readOnly=true to NagpraManager when not editing', () => {
    wrap(<NagpraSection {...baseProps} />);
    expect(screen.getByTestId('nagpra-manager')).toHaveTextContent('readOnly:true');
  });
});

describe('AcquisitionSection (edit-mode wiring)', () => {
  const props = {
    ...baseProps,
    formData: {
      ...baseFormData,
      provenance: 'A short provenance entry',
      object_history_note: 'Collected in 1990',
      usage: 'Ceremonial',
      associated_cultural_affinity: 'Edo Japan',
      acquisition_method: 'gift',
      acquisition_date: '2020-06-15',
      acquisition_source: 'Smith Estate',
      credit_line: 'Gift of Smith Family',
    } as FormData,
    updateField: vi.fn(),
    handleFieldBlur: vi.fn(),
  };

  it('renders editable inputs that reflect formData values', () => {
    wrap(<AcquisitionSection {...props} isEditing />);
    const inputs = screen.getAllByRole('textbox');
    const values = inputs.map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value);
    expect(values).toContain('A short provenance entry');
    expect(values).toContain('Collected in 1990');
    expect(values).toContain('Ceremonial');
    expect(values).toContain('Edo Japan');
  });

  it('calls updateField when provenance is edited', () => {
    wrap(<AcquisitionSection {...props} isEditing />);
    const inputs = screen.getAllByRole('textbox');
    const provenanceInput = inputs.find(
      (el) =>
        (el as HTMLInputElement | HTMLTextAreaElement).value ===
        'A short provenance entry',
    )!;
    fireEvent.change(provenanceInput, { target: { value: 'Updated' } });
    expect(props.updateField).toHaveBeenCalledWith('provenance', 'Updated');
  });
});

describe('ConditionSection (edit-mode wiring)', () => {
  const props = {
    ...baseProps,
    formData: {
      ...baseFormData,
      completeness: 'complete',
      conservation_priority: 'medium',
      salvage_priority: 'low',
      condition_note: 'Stable',
      handling_requirements: 'Handle with gloves',
    } as FormData,
    updateField: vi.fn(),
    handleFieldBlur: vi.fn(),
  };

  it('renders inputs hydrated from formData when editing', () => {
    wrap(<ConditionSection {...props} isEditing />);
    const inputs = screen.getAllByRole('textbox');
    const values = inputs.map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value);
    expect(values).toContain('Stable');
    expect(values).toContain('Handle with gloves');
  });
});

describe('PartsSection', () => {
  it('renders "Parts" title', () => {
    wrap(<PartsSection {...baseProps} object={makeCollectionObject()} />);
    expect(screen.getByText('Parts')).toBeInTheDocument();
  });

  it('shows a parts count badge when there is more than one part', () => {
    wrap(
      <PartsSection
        {...baseProps}
        expandedSections={{ ...baseProps.expandedSections, parts: false }}
        object={makeCollectionObject({
          parts: [
            { part_id: 'p-1' } as never,
            { part_id: 'p-2' } as never,
            { part_id: 'p-3' } as never,
          ],
        })}
      />,
    );
    expect(screen.getByText('3 parts')).toBeInTheDocument();
  });

  it('does not render a parts count badge when there is only one part', () => {
    wrap(
      <PartsSection
        {...baseProps}
        expandedSections={{ ...baseProps.expandedSections, parts: false }}
        object={makeCollectionObject({
          parts: [{ part_id: 'p-1' } as never],
        })}
      />,
    );
    expect(screen.queryByText(/^\d+ parts$/)).toBeNull();
  });
});
