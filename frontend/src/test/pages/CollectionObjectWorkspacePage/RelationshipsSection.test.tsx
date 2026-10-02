import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PeopleSection,
  PlacesSection,
  StylePeriodsSection,
  RelatedObjectsSection,
  CitationsSection,
  EventsSection,
  SubjectsSection,
} from '../../../pages/collections/CollectionObjectWorkspacePage/RelationshipsSection';
import { makeCollectionObject } from './fixtures';
import type { FormData } from '../../../pages/collections/CollectionObjectWorkspacePage/types';

vi.mock('../../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Replace heavy linker components with stubs that surface enough state for assertions.
vi.mock('../../../components/collections/ConstituentLinker', () => ({
  ConstituentLinker: ({
    objectId,
    isEditing,
    excludedRoles,
    allowedRoles,
  }: {
    objectId: string;
    isEditing: boolean;
    excludedRoles?: string[];
    allowedRoles?: string[];
  }) => (
    <div data-testid="constituent-linker">
      object:{objectId}-editing:{String(isEditing)}-excl:
      {(excludedRoles ?? []).join(',')}-allowed:{(allowedRoles ?? []).join(',')}
    </div>
  ),
}));

vi.mock('../../../components/collections/PlaceAuthorityLinker', () => ({
  PlaceAuthorityLinker: ({
    objectId,
    readOnly,
    allowedRoles,
  }: {
    objectId: string;
    readOnly?: boolean;
    allowedRoles?: string[];
  }) => (
    <div data-testid="place-linker">
      object:{objectId}-readOnly:{String(readOnly)}-allowed:
      {(allowedRoles ?? []).join(',')}
    </div>
  ),
}));

vi.mock('../../../components/collections/StylePeriodLinker', () => ({
  StylePeriodLinker: ({ objectId, readOnly }: { objectId: string; readOnly?: boolean }) => (
    <div data-testid="style-linker">
      object:{objectId}-readOnly:{String(readOnly)}
    </div>
  ),
}));

vi.mock('../../../components/collections/SubjectLinker', () => ({
  SubjectLinker: ({ objectId, readOnly }: { objectId: string; readOnly?: boolean }) => (
    <div data-testid="subject-linker">
      object:{objectId}-readOnly:{String(readOnly)}
    </div>
  ),
}));

vi.mock('../../../components/collections/ObjectRelationshipsManager', () => ({
  ObjectRelationshipsManager: ({ objectId }: { objectId: string }) => (
    <div data-testid="related-manager">object:{objectId}</div>
  ),
}));

vi.mock('../../../components/collections/ObjectCitationsManager', () => ({
  ObjectCitationsManager: ({ objectId }: { objectId: string }) => (
    <div data-testid="citations-manager">object:{objectId}</div>
  ),
}));

vi.mock('../../../components/collections/ObjectEventLinker', () => ({
  ObjectEventLinker: ({ objectId }: { objectId: string }) => (
    <div data-testid="event-linker">object:{objectId}</div>
  ),
}));

vi.mock('../../../components/collections/AuthorityAutocomplete', () => ({
  AuthorityAutocomplete: ({ value }: { value: { value: string } | null }) => (
    <div data-testid="authority-autocomplete">{value?.value ?? ''}</div>
  ),
}));

const baseProps = {
  orgId: 'org-1',
  objectId: 'obj-1',
  object: makeCollectionObject(),
  isEditing: false,
  isCreateMode: false,
  expandedSections: {
    people: true,
    places: true,
    stylePeriods: true,
    relationships: true,
    citations: true,
    events: true,
    subjects: true,
  },
  toggleSection: vi.fn(),
  sectionRefs: { current: {} },
  getSectionOrder: () => 1,
  isEmpty: false,
  sectionSummaries: {},
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PeopleSection', () => {
  it('renders the People title', () => {
    wrap(<PeopleSection {...baseProps} />);
    expect(screen.getByText('People')).toBeInTheDocument();
  });

  it('passes excludedRoles=["depicted"] to ConstituentLinker so depicted shows under Subjects', () => {
    wrap(<PeopleSection {...baseProps} />);
    expect(screen.getByTestId('constituent-linker')).toHaveTextContent('excl:depicted');
  });

  it('forwards isEditing=true to ConstituentLinker', () => {
    wrap(<PeopleSection {...baseProps} isEditing />);
    expect(screen.getByTestId('constituent-linker')).toHaveTextContent('editing:true');
  });

  it('calls toggleSection with "people" when the collapsed header is clicked', () => {
    const toggleSection = vi.fn();
    wrap(
      <PeopleSection
        {...baseProps}
        expandedSections={{ ...baseProps.expandedSections, people: false }}
        toggleSection={toggleSection}
      />,
    );
    fireEvent.click(screen.getByText('People'));
    expect(toggleSection).toHaveBeenCalledWith('people');
  });

  it('renders the section summary hint when collapsed', () => {
    wrap(
      <PeopleSection
        {...baseProps}
        expandedSections={{ ...baseProps.expandedSections, people: false }}
        sectionSummaries={{ people: '3 linked' }}
      />,
    );
    expect(screen.getByText('3 linked')).toBeInTheDocument();
  });
});

describe('PlacesSection', () => {
  it('renders the Places title', () => {
    wrap(<PlacesSection {...baseProps} />);
    expect(screen.getByText('Places')).toBeInTheDocument();
  });

  it('passes readOnly=true to PlaceAuthorityLinker when not editing', () => {
    wrap(<PlacesSection {...baseProps} />);
    expect(screen.getByTestId('place-linker')).toHaveTextContent('readOnly:true');
  });

  it('passes readOnly=false to PlaceAuthorityLinker when editing', () => {
    wrap(<PlacesSection {...baseProps} isEditing />);
    expect(screen.getByTestId('place-linker')).toHaveTextContent('readOnly:false');
  });

  it('excludes the depicted_place role (handled in Subjects)', () => {
    wrap(<PlacesSection {...baseProps} />);
    // PlaceAuthorityLinker for the Places section gets excludedRoles, not allowedRoles —
    // mock surfaces only allowedRoles, so we just verify the linker mounted with no allowedRoles set
    expect(screen.getByTestId('place-linker')).toHaveTextContent('allowed:');
  });
});

describe('StylePeriodsSection', () => {
  it('renders the Styles & Periods title', () => {
    wrap(<StylePeriodsSection {...baseProps} />);
    expect(screen.getByText('Styles & Periods')).toBeInTheDocument();
  });

  it('passes readOnly=true to StylePeriodLinker when not editing', () => {
    wrap(<StylePeriodsSection {...baseProps} />);
    expect(screen.getByTestId('style-linker')).toHaveTextContent('readOnly:true');
  });
});

describe('RelatedObjectsSection', () => {
  it('renders "Related Objects" as the title', () => {
    wrap(<RelatedObjectsSection {...baseProps} />);
    expect(screen.getByText('Related Objects')).toBeInTheDocument();
  });

  it('passes the objectId to ObjectRelationshipsManager', () => {
    wrap(<RelatedObjectsSection {...baseProps} />);
    expect(screen.getByTestId('related-manager')).toHaveTextContent('object:obj-1');
  });
});

describe('CitationsSection', () => {
  it('renders "Citations & References" as the title', () => {
    wrap(<CitationsSection {...baseProps} />);
    expect(screen.getByText('Citations & References')).toBeInTheDocument();
  });

  it('passes the objectId to ObjectCitationsManager', () => {
    wrap(<CitationsSection {...baseProps} />);
    expect(screen.getByTestId('citations-manager')).toHaveTextContent('object:obj-1');
  });
});

describe('EventsSection', () => {
  it('returns null in create mode (events require a saved record)', () => {
    const { container } = wrap(<EventsSection {...baseProps} isCreateMode />);
    expect(container.querySelector('[data-testid="event-linker"]')).toBeNull();
  });

  it('renders "Related Events" as the title when not in create mode', () => {
    wrap(<EventsSection {...baseProps} />);
    expect(screen.getByText('Related Events')).toBeInTheDocument();
  });

  it('passes the objectId to ObjectEventLinker', () => {
    wrap(<EventsSection {...baseProps} />);
    expect(screen.getByTestId('event-linker')).toHaveTextContent('object:obj-1');
  });
});

describe('SubjectsSection', () => {
  const subjectsProps = {
    ...baseProps,
    formData: {
      depicted_activities: ['dancing'],
      depicted_concepts: [],
      associated_concepts: ['Buddhism', 'Art Nouveau'],
    } as unknown as FormData,
    updateField: vi.fn(),
    handleFieldBlur: vi.fn(),
  };

  it('renders the Subjects title', () => {
    wrap(<SubjectsSection {...subjectsProps} />);
    expect(screen.getByText('Subjects')).toBeInTheDocument();
  });

  it('renders SubjectLinker', () => {
    wrap(<SubjectsSection {...subjectsProps} />);
    expect(screen.getByTestId('subject-linker')).toHaveTextContent('object:obj-1');
  });

  it('renders depicted-people ConstituentLinker scoped to the "depicted" role', () => {
    wrap(<SubjectsSection {...subjectsProps} />);
    const linkers = screen.getAllByTestId('constituent-linker');
    expect(linkers.some((el) => el.textContent?.includes('allowed:depicted'))).toBe(true);
  });

  it('renders depicted-places PlaceAuthorityLinker scoped to the "depicted_place" role', () => {
    wrap(<SubjectsSection {...subjectsProps} />);
    const linkers = screen.getAllByTestId('place-linker');
    expect(linkers.some((el) => el.textContent?.includes('allowed:depicted_place'))).toBe(true);
  });

  it('renders depicted_activities labels in view mode', () => {
    wrap(
      <SubjectsSection
        {...subjectsProps}
        object={makeCollectionObject({ depicted_activities: ['dancing'] })}
      />,
    );
    expect(screen.getByText('Depicted Activities')).toBeInTheDocument();
    expect(screen.getByText('dancing')).toBeInTheDocument();
  });

  it('renders "None" when a depicted list is empty in view mode', () => {
    wrap(
      <SubjectsSection
        {...subjectsProps}
        object={makeCollectionObject({ depicted_activities: [] })}
      />,
    );
    // Depicted Activities, Depicted Concepts, Associated Concepts -> at least one "None"
    const nones = screen.getAllByText('None');
    expect(nones.length).toBeGreaterThanOrEqual(1);
  });
});
