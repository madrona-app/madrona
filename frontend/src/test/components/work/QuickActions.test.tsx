import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickActions } from '../../../components/work/QuickActions';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const { useWorkMock, useOrganizationMock } = vi.hoisted(() => ({
  useWorkMock: vi.fn(),
  useOrganizationMock: vi.fn(),
}));

vi.mock('../../../contexts/WorkContext', () => ({
  useWork: useWorkMock,
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: useOrganizationMock,
}));

const ACTIONS = [
  {
    id: 'cr',
    label: 'Condition Report',
    description: 'Document object condition',
    icon: 'ClipboardCheck',
    requiresObjectContext: true,
    owningGroup: 'Care',
  },
  {
    id: 'mv',
    label: 'Movement',
    description: 'Track movements',
    icon: 'ArrowRightLeft',
    requiresObjectContext: false,
    owningGroup: 'Location',
  },
];

function setup(opts: { hasObjectContext?: boolean; activeObject?: object | null } = {}) {
  useWorkMock.mockReturnValue({
    activeObject: opts.activeObject ?? null,
    hasObjectContext: opts.hasObjectContext ?? false,
    quickActions: ACTIONS,
    buildActionPath: (a: { id: string }) => `/path/${a.id}`,
  });
  useOrganizationMock.mockReturnValue({
    activeOrganization: { organization_id: 'org-1' },
  });
}

describe('QuickActions', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useWorkMock.mockReset();
    useOrganizationMock.mockReset();
  });

  it('renders all action labels in cards mode', () => {
    setup();
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>,
    );
    expect(screen.getByText('Condition Report')).toBeInTheDocument();
    expect(screen.getByText('Movement')).toBeInTheDocument();
  });

  it('shows "Requires object" label on context-bound actions when no object active', () => {
    setup({ hasObjectContext: false });
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>,
    );
    expect(screen.getByText('Requires object')).toBeInTheDocument();
  });

  it('shows context indicator chip when object context is active', () => {
    setup({
      hasObjectContext: true,
      activeObject: { accession_number: '2024.5' },
    });
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>,
    );
    expect(screen.getByText('2024.5')).toBeInTheDocument();
  });

  it('clicking a non-restricted action navigates immediately', () => {
    setup({ hasObjectContext: false });
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Movement'));
    expect(navigateMock).toHaveBeenCalledWith('/path/mv');
  });

  it('clicking a restricted action without context calls onObjectSelectionRequired', () => {
    setup({ hasObjectContext: false });
    const callback = vi.fn();
    render(
      <MemoryRouter>
        <QuickActions onObjectSelectionRequired={callback} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Condition Report'));
    expect(callback).toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('clicking a restricted action with object context navigates', () => {
    setup({
      hasObjectContext: true,
      activeObject: { accession_number: 'X' },
    });
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Condition Report'));
    expect(navigateMock).toHaveBeenCalledWith('/path/cr');
  });

  it('compact variant renders flat buttons without descriptions', () => {
    setup();
    render(
      <MemoryRouter>
        <QuickActions variant="compact" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Movement')).toBeInTheDocument();
    expect(screen.queryByText('Track movements')).toBeNull();
  });

  it('respects limit prop', () => {
    setup();
    render(
      <MemoryRouter>
        <QuickActions limit={1} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Condition Report')).toBeInTheDocument();
    expect(screen.queryByText('Movement')).toBeNull();
  });

  it('shows the global help text when no object context', () => {
    setup({ hasObjectContext: false });
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Some actions require an active object/i),
    ).toBeInTheDocument();
  });
});
