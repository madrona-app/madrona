import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhysicalSection } from '../../../pages/collections/CollectionObjectWorkspacePage/PhysicalSection';
import { makeCollectionObject } from './fixtures';
import type { FormData } from '../../../pages/collections/CollectionObjectWorkspacePage/types';

vi.mock('../../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../components/collections/MaterialLinker', () => ({
  MaterialLinker: ({ objectId, isEditing }: { objectId: string; isEditing: boolean }) => (
    <div data-testid="material-linker">object:{objectId}-editing:{String(isEditing)}</div>
  ),
}));

vi.mock('../../../components/collections/TechniqueLinker', () => ({
  TechniqueLinker: ({ objectId, isEditing }: { objectId: string; isEditing: boolean }) => (
    <div data-testid="technique-linker">object:{objectId}-editing:{String(isEditing)}</div>
  ),
}));

vi.mock('../../../components/collections/ObjectFieldComponents', () => ({
  MeasurementsField: ({ measurements }: { measurements: unknown[] }) => (
    <div data-testid="measurements-field">measurements:{measurements?.length ?? 0}</div>
  ),
  InscriptionsField: ({ inscriptions }: { inscriptions: unknown[] }) => (
    <div data-testid="inscriptions-field">inscriptions:{inscriptions?.length ?? 0}</div>
  ),
  NameListField: ({ label, items }: { label: string; items: unknown[] }) => (
    <div data-testid={`namelist-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      {label}:{items?.length ?? 0}
    </div>
  ),
}));

const baseFormData = {
  physical_description: '',
  color: '',
  form: '',
  orientation: '',
  measurements: [],
  inscriptions: [],
  watermarks: [],
  technical_attributes: [],
  edition: '',
  copy_number: '',
  edition_note: '',
  state_number: null,
  total_states: null,
  state_description: '',
  catalog_level: '',
  age: '',
  age_qualifier: '',
  age_unit: '',
  facture_description: '',
  arrangement: '',
  installation_instructions: '',
} as unknown as FormData;

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    objectId: 'obj-1',
    isEditing: false,
    isCreateMode: false,
    formData: baseFormData,
    object: makeCollectionObject({
      color: 'blue and white',
      measurements: [
        { dimension: 'height', value: 25, unit: 'cm', part: null },
      ] as never,
    }),
    updateField: vi.fn(),
    updateFieldSilent: vi.fn(),
    handleFieldBlur: vi.fn(),
    expandedSections: { physical: true },
    toggleSection: vi.fn(),
    sectionRefs: { current: {} },
    getSectionOrder: () => 1,
    isEmpty: false,
    sectionSummaries: { physical: '2 materials · 1 technique' },
    isRestricted: () => false,
    ...overrides,
  } as Parameters<typeof PhysicalSection>[0];
}

function renderSection(props: Parameters<typeof PhysicalSection>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PhysicalSection {...props} />
    </QueryClientProvider>,
  );
}

describe('PhysicalSection', () => {
  it('renders "Physical Description" as the title', () => {
    renderSection(makeProps());
    expect(screen.getAllByText('Physical Description').length).toBeGreaterThan(0);
  });

  it('renders the saved color value in view mode', () => {
    renderSection(makeProps());
    expect(screen.getByText('blue and white')).toBeInTheDocument();
  });

  it('renders MaterialLinker and TechniqueLinker', () => {
    renderSection(makeProps());
    expect(screen.getByTestId('material-linker')).toHaveTextContent('object:obj-1');
    expect(screen.getByTestId('technique-linker')).toHaveTextContent('object:obj-1');
  });

  it('forwards isEditing through to MaterialLinker and TechniqueLinker', () => {
    renderSection(makeProps({ isEditing: true }));
    expect(screen.getByTestId('material-linker')).toHaveTextContent('editing:true');
    expect(screen.getByTestId('technique-linker')).toHaveTextContent('editing:true');
  });

  it('passes saved measurements to MeasurementsField when not editing', () => {
    renderSection(makeProps());
    expect(screen.getByTestId('measurements-field')).toHaveTextContent('measurements:1');
  });

  it('passes form measurements to MeasurementsField when editing', () => {
    renderSection(
      makeProps({
        isEditing: true,
        formData: {
          ...baseFormData,
          measurements: [
            { dimension: 'h', value: 1, unit: 'cm', part: null },
            { dimension: 'w', value: 2, unit: 'cm', part: null },
          ],
        } as FormData,
      }),
    );
    expect(screen.getByTestId('measurements-field')).toHaveTextContent('measurements:2');
  });

  it('renders the Edition & Print State subheading', () => {
    renderSection(makeProps());
    expect(screen.getByText('Edition & Print State')).toBeInTheDocument();
  });

  it('renders the Construction & Installation subheading', () => {
    renderSection(makeProps());
    expect(screen.getByText('Construction & Installation')).toBeInTheDocument();
  });

  it('calls toggleSection with "physical" when collapsed header is clicked', () => {
    const toggleSection = vi.fn();
    renderSection(
      makeProps({
        expandedSections: { physical: false },
        toggleSection,
      }),
    );
    // Section title appears in the collapsed card heading
    fireEvent.click(screen.getAllByText('Physical Description')[0]);
    expect(toggleSection).toHaveBeenCalledWith('physical');
  });

  it('shows the physical hint when collapsed', () => {
    renderSection(makeProps({ expandedSections: { physical: false } }));
    expect(screen.getByText('2 materials · 1 technique')).toBeInTheDocument();
  });

  it('renders all editable fields in edit mode (view-mode short-circuits "empty" fields)', () => {
    renderSection(
      makeProps({
        isEditing: true,
        formData: {
          ...baseFormData,
          physical_description: 'Stoneware, glazed',
          color: 'blue',
          form: 'cylindrical',
          orientation: 'upright',
          edition: '2nd',
          copy_number: '3/50',
          edition_note: 'signed',
          state_number: 1,
          total_states: 3,
          state_description: 'first state',
          catalog_level: 'item',
          age: '200',
          age_qualifier: 'circa',
          age_unit: 'years',
          facture_description: 'thrown on wheel',
          arrangement: 'hanging',
          installation_instructions: 'requires mount',
        } as FormData,
      }),
    );
    expect(screen.getByText('Edition & Print State')).toBeInTheDocument();
    expect(screen.getByText('Construction & Installation')).toBeInTheDocument();
  });

  it('forwards saved values from the object in view mode for all populated fields', () => {
    renderSection(
      makeProps({
        object: makeCollectionObject({
          physical_description: 'Stoneware',
          color: 'green',
          form: 'oval',
          orientation: 'landscape',
          edition: '1st',
          copy_number: '1/10',
          age: '500',
          state_description: 'second state',
        }),
      }),
    );
    expect(screen.getByText('Stoneware')).toBeInTheDocument();
    expect(screen.getByText('green')).toBeInTheDocument();
    expect(screen.getByText('oval')).toBeInTheDocument();
    expect(screen.getByText('landscape')).toBeInTheDocument();
    expect(screen.getByText('1st')).toBeInTheDocument();
    expect(screen.getByText('1/10')).toBeInTheDocument();
  });

  it('calls updateField when color input changes in edit mode', () => {
    const updateField = vi.fn();
    renderSection(
      makeProps({
        isEditing: true,
        updateField,
        formData: { ...baseFormData, color: 'red' } as FormData,
      }),
    );
    const colorInputs = screen.getAllByRole('textbox').filter(
      (el) => (el as HTMLInputElement).value === 'red',
    );
    expect(colorInputs.length).toBeGreaterThan(0);
    // simulate user typing
    const evt = { target: { value: 'red and gold' } };
    colorInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    // change event fired via fireEvent below
    fireEvent.change(colorInputs[0], evt as unknown as Event);
    expect(updateField).toHaveBeenCalledWith('color', 'red and gold');
  });
});
