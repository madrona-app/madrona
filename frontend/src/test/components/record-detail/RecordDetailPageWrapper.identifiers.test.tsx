/**
 * The rail and the key-info strip were written for collection objects: the
 * identifier row said "Object #" no matter what, and the location row always
 * rendered. Pages for records that are not objects reuse this wrapper, so a
 * person showed "OBJECT # — Person" and a Location that could never be set.
 *
 * These render the REAL rail and strip through the wrapper (only the layout
 * shell and unrelated leaves are stubbed) so the pass-through wiring is
 * covered, not just the leaf components' own props.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RecordDetailPageWrapper } from '../../../components/record-detail/RecordDetailPageWrapper';

vi.mock('../../../lib/api/media-dam', () => ({ getDownloadUrl: vi.fn() }));
vi.mock('../../../lib/download', () => ({ downloadWithFilename: vi.fn() }));
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

vi.mock('../../../components/record-detail/RecordDetailLayout', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    RecordDetailLayout: pass,
    RecordDetailHeaderArea: pass,
    RecordDetailSectionNav: pass,
    RecordDetailMain: pass,
    RecordDetailRail: pass,
  };
});
vi.mock('../../../components/record-detail/SectionNav', () => ({
  SectionNav: () => null,
  DEFAULT_SECTION_GROUPS: [],
}));
vi.mock('../../../components/record-detail/RecordHeader', () => ({ RecordHeader: () => null }));
vi.mock('../../../components/record-detail/ImageModal', () => ({ ImageModal: () => null }));

function renderWrapper(props: Record<string, unknown>) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RecordDetailPageWrapper showHeader showRail {...props}>
          <div>page content</div>
        </RecordDetailPageWrapper>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Exactly what ConstituentWorkspacePage passes. */
const PERSON_PROPS = {
  object: {
    object_id: 'c-1',
    object_number: null,
    object_type: 'Person',
    object_status: 'active',
  },
  showLocation: false,
  showRights: false,
  title: 'Ada Lovelace',
};

/**
 * Both surfaces render in jsdom — the strip is hidden by a CSS breakpoint,
 * not by React — so assertions are scoped to one surface at a time.
 */
const rail = (c: HTMLElement) => c.querySelector('dl') as HTMLElement;
const strip = () => screen.getByRole('region', { name: /key record information/i });

describe('RecordDetailPageWrapper — a record that is not a collection object', () => {
  it('does not label a person with an object number', () => {
    renderWrapper(PERSON_PROPS);
    expect(screen.queryByText('Object #')).not.toBeInTheDocument();
  });

  it('does not show a location a person can never have', () => {
    renderWrapper(PERSON_PROPS);
    expect(screen.queryByText('Location')).not.toBeInTheDocument();
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
  });

  it('does not repeat the type as an identifier in the rail', () => {
    // The regression: object_number was the type label, so "Person" rendered
    // twice within the rail — once under OBJECT #, once under TYPE.
    const { container } = renderWrapper(PERSON_PROPS);
    expect(within(rail(container)).getAllByText('Person')).toHaveLength(1);
  });

  it('does not repeat the type as an identifier in the strip', () => {
    renderWrapper(PERSON_PROPS);
    expect(within(strip()).getAllByText('Person')).toHaveLength(1);
  });

  it('does not claim a rights status for a person', () => {
    // Rights attach to objects and media. The strip defaulted to
    // "Rights: Unknown", which reads as missing data rather than N/A.
    renderWrapper(PERSON_PROPS);
    expect(screen.queryByText(/^Rights:/)).not.toBeInTheDocument();
  });

  it('leaves no dangling separator when location and rights are both off', () => {
    const { container } = renderWrapper(PERSON_PROPS);
    const bullets = within(strip()).queryAllByText('\u2022');
    // Two items remain (Type, Status) so exactly one separator sits between.
    expect(bullets).toHaveLength(1);
    expect(container).toBeTruthy();
  });

  it('still shows the identifiers a person does have', () => {
    const { container } = renderWrapper(PERSON_PROPS);
    const railScope = within(rail(container));
    expect(railScope.getByText('Type')).toBeInTheDocument();
    expect(railScope.getByText('Person')).toBeInTheDocument();
    expect(railScope.getByText('Active')).toBeInTheDocument();
  });
});

describe('RecordDetailPageWrapper — collection objects are unchanged', () => {
  const OBJECT_PROPS = {
    object: {
      object_id: 'o-1',
      object_number: '2024.12',
      object_type: 'painting',
      object_status: 'active',
      current_location_name: 'Vault B',
    },
    title: 'Untitled',
  };

  it('still labels the accession number "Object #"', () => {
    renderWrapper(OBJECT_PROPS);
    expect(screen.getAllByText('Object #').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2024.12').length).toBeGreaterThan(0);
  });

  it('still shows the location', () => {
    renderWrapper(OBJECT_PROPS);
    expect(screen.getAllByText('Location').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vault B').length).toBeGreaterThan(0);
  });

  it('forwards a custom identifier label to both the rail and the strip', () => {
    renderWrapper({ ...OBJECT_PROPS, identifierLabel: 'Entry #' });
    // Rail and strip both render; both must pick up the override.
    expect(screen.getAllByText('Entry #')).toHaveLength(2);
    expect(screen.queryByText('Object #')).not.toBeInTheDocument();
  });
});

/**
 * Most pages using this wrapper are not collection objects at all: they pass
 * a record identifier through `objectNumber` and no `object`. The strip was
 * labeling those "Object #" and pairing them with a permanent
 * "Location: Not set" and "Rights: Unknown".
 */
describe('RecordDetailPageWrapper — pages that pass an identifier but no object', () => {
  const ACQUISITION_PROPS = {
    objectNumber: 'ACQ2026.0001',
    title: 'Smith Bequest',
    media: [{ media_id: 'm1', filename: 'a.jpg', thumbnail_url: 'http://x/t.jpg' }],
  };

  it('does not call an acquisition number an object number', () => {
    renderWrapper(ACQUISITION_PROPS);
    expect(screen.queryByText('Object #')).not.toBeInTheDocument();
    expect(screen.getByText('ACQ2026.0001')).toBeInTheDocument();
  });

  it('does not invent a location for a record that has none', () => {
    renderWrapper(ACQUISITION_PROPS);
    expect(screen.queryByText('Location')).not.toBeInTheDocument();
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
  });

  it('does not claim an unknown rights status for a record with no rights', () => {
    renderWrapper(ACQUISITION_PROPS);
    expect(screen.queryByText(/^Rights:/)).not.toBeInTheDocument();
  });

  it('lets a page name its own identifier', () => {
    // What ObjectEntryWorkspacePage now does.
    renderWrapper({ ...ACQUISITION_PROPS, objectNumber: 'ENT-2026.4', identifierLabel: 'Entry #' });
    expect(screen.getByText('Entry #')).toBeInTheDocument();
    expect(screen.getByText('ENT-2026.4')).toBeInTheDocument();
  });

  it('still labels a real collection object "Object #"', () => {
    renderWrapper({
      object: {
        object_id: 'o-1',
        object_number: '2024.12',
        object_type: 'painting',
        object_status: 'active',
        current_location_name: 'Vault B',
      },
    });
    expect(screen.getAllByText('Object #').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Location').length).toBeGreaterThan(0);
  });
});
