import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IdentificationSection } from '../../../pages/collections/CollectionObjectWorkspacePage/IdentificationSection';
import { makeCollectionObject } from './fixtures';
import type { FormData } from '../../../pages/collections/CollectionObjectWorkspacePage/types';

vi.mock('../../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({
  getOtherNumberTypes: vi.fn().mockResolvedValue({ types: [] }),
}));

// Heavy children — replace with stubs that show enough to verify wiring
vi.mock('../../../components/collections/ObjectFieldComponents', () => ({
  TitlesField: ({ titles, isEditing }: { titles: unknown[]; isEditing: boolean }) => (
    <div data-testid="titles-field">
      titles:{titles?.length ?? 0}-editing:{String(isEditing)}
    </div>
  ),
  ClassificationsField: ({ classifications }: { classifications: unknown[] }) => (
    <div data-testid="classifications-field">
      classifications:{classifications?.length ?? 0}
    </div>
  ),
}));

vi.mock('../../../components/collections/DepartmentSelector', () => ({
  DepartmentSelector: ({ value, label }: { value: string | null; label: string }) => (
    <div data-testid="department-selector">{label}:{value || 'none'}</div>
  ),
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupCategory: () => ({ options: [{ value: 'painting', label: 'Painting' }], loading: false }),
}));

const baseFormData: Partial<FormData> = {
  object_number: '',
  object_name: '',
  object_type: '',
  object_status: 'active',
  number_of_objects: 1,
  titles: [],
  classifications: [],
  other_numbers: [],
  department_id: null,
  creation_date_display: '',
  creation_place: '',
  production_reason: '',
  production_note: '',
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    objectId: 'obj-1',
    isEditing: false,
    isCreateMode: false,
    formData: baseFormData as FormData,
    object: makeCollectionObject({
      object_number: '2024.001',
      object_name: 'Vase',
      object_type: 'ceramic',
      creation_date_display: 'c. 1500',
      creation_place: 'Jingdezhen, China',
    }),
    updateField: vi.fn(),
    updateFieldSilent: vi.fn(),
    handleFieldBlur: vi.fn(),
    expandedSections: { identification: true },
    toggleSection: vi.fn(),
    sectionRefs: { current: {} },
    getSectionOrder: () => 1,
    isEmpty: false,
    sectionSummaries: { identification: 'Ceramic · 2024.001 · Accessioned' },
    isRestricted: () => false,
    ...overrides,
  } as Parameters<typeof IdentificationSection>[0];
}

function renderSection(props: Parameters<typeof IdentificationSection>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IdentificationSection {...props} />
    </QueryClientProvider>,
  );
}

describe('IdentificationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('view mode', () => {
    it('renders the section title "Identification"', () => {
      renderSection(makeProps({ expandedSections: { identification: false } }));
      expect(screen.getByText('Identification')).toBeInTheDocument();
    });

    it('renders the saved object_number from object data', () => {
      renderSection(makeProps());
      expect(screen.getByText('2024.001')).toBeInTheDocument();
    });

    it('renders the saved object_name from object data', () => {
      renderSection(makeProps());
      expect(screen.getByText('Vase')).toBeInTheDocument();
    });

    it('renders the section hint when collapsed', () => {
      renderSection(makeProps({ expandedSections: { identification: false } }));
      expect(screen.getByText('Ceramic · 2024.001 · Accessioned')).toBeInTheDocument();
    });

    it('passes saved titles to TitlesField when not editing', () => {
      renderSection(
        makeProps({
          object: makeCollectionObject({
            titles: [
              { title: 'Title 1' } as never,
              { title: 'Title 2' } as never,
            ],
          }),
        }),
      );
      expect(screen.getByTestId('titles-field')).toHaveTextContent('titles:2-editing:false');
    });

    it('passes saved classifications to ClassificationsField when not editing', () => {
      renderSection(
        makeProps({
          object: makeCollectionObject({
            classifications: [
              { term: 'ceramic' } as never,
              { term: 'vessel' } as never,
            ],
          }),
        }),
      );
      expect(screen.getByTestId('classifications-field')).toHaveTextContent('classifications:2');
    });
  });

  describe('edit mode', () => {
    it('renders form values from formData rather than object', () => {
      renderSection(
        makeProps({
          isEditing: true,
          formData: {
            ...baseFormData,
            object_number: 'NEW-001',
            object_name: 'New Name',
          } as FormData,
        }),
      );
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.some((el) => (el as HTMLInputElement).value === 'NEW-001')).toBe(true);
      expect(inputs.some((el) => (el as HTMLInputElement).value === 'New Name')).toBe(true);
    });

    it('calls updateField when object_number is typed into', () => {
      const updateField = vi.fn();
      renderSection(
        makeProps({
          isEditing: true,
          updateField,
          formData: { ...baseFormData, object_number: 'A' } as FormData,
        }),
      );
      const inputs = screen.getAllByRole('textbox');
      const objectNumberInput = inputs.find((el) => (el as HTMLInputElement).value === 'A')!;
      fireEvent.change(objectNumberInput, { target: { value: 'A.123' } });
      expect(updateField).toHaveBeenCalledWith('object_number', 'A.123');
    });

    it('passes editing state through to TitlesField', () => {
      renderSection(makeProps({ isEditing: true }));
      expect(screen.getByTestId('titles-field')).toHaveTextContent('editing:true');
    });

    it('renders the Object Type select with options', () => {
      renderSection(makeProps({ isEditing: true }));
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBeGreaterThan(0);
    });
  });

  describe('toggle behavior', () => {
    it('calls toggleSection with "identification" when the collapsed header is clicked', () => {
      const toggleSection = vi.fn();
      renderSection(
        makeProps({
          expandedSections: { identification: false },
          toggleSection,
        }),
      );
      fireEvent.click(screen.getByText('Identification'));
      expect(toggleSection).toHaveBeenCalledWith('identification');
    });
  });
});
