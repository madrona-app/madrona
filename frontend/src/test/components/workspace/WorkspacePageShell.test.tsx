import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Box } from 'lucide-react';
import { WorkspacePageShell } from '../../../components/workspace/WorkspacePageShell';

vi.mock('../../../components/record-detail', () => ({
  SectionOrderProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="section-order-provider">{children}</div>
  ),
}));

function renderShell(props: Partial<React.ComponentProps<typeof WorkspacePageShell>> = {}) {
  return render(
    <MemoryRouter>
      <WorkspacePageShell
        isLoading={false}
        error={null}
        isCreateMode={false}
        entityName="Movement"
        backUrl="/back"
        entityData={{ id: 'x' }}
        {...props}
      >
        <div>page content</div>
      </WorkspacePageShell>
    </MemoryRouter>,
  );
}

describe('WorkspacePageShell', () => {
  it('renders children inside SectionOrderProvider when ready', () => {
    renderShell();
    expect(screen.getByTestId('section-order-provider')).toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading=true and not in create mode', () => {
    renderShell({ isLoading: true, entityData: undefined });
    expect(screen.getByLabelText(/Loading movement…/i)).toBeInTheDocument();
    expect(screen.queryByText('page content')).toBeNull();
  });

  it('skips loading skeleton when isCreateMode=true', () => {
    renderShell({ isLoading: true, isCreateMode: true, entityData: null });
    expect(screen.queryByLabelText(/Loading/)).toBeNull();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('shows entity-not-found state when error is set', () => {
    renderShell({ error: new Error('boom'), entityData: null });
    expect(screen.getByText('Movement not found')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows generic not-found copy when error is null but entityData is missing', () => {
    renderShell({ entityData: null });
    expect(screen.getByText('Movement not found')).toBeInTheDocument();
    expect(
      screen.getByText(/The movement record could not be loaded/),
    ).toBeInTheDocument();
  });

  it('renders a back link to the list page in error state', () => {
    renderShell({ entityData: null });
    const link = screen.getByText(/Back to Movements/);
    expect(link.getAttribute('href')).toBe('/back');
  });

  it('renders the supplied icon in error state', () => {
    const { container } = renderShell({ entityData: null, icon: Box });
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders skeleton blocks in loading state', () => {
    const { container } = renderShell({ isLoading: true, entityData: undefined });
    expect(container.querySelectorAll('.bg-stone\\/50').length).toBeGreaterThan(0);
  });
});
