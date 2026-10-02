import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MadronaSyncDrawer from '../../components/MadronaSyncDrawer';

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'org-1' }),
}));

vi.mock('../../hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false }),
}));

const baseRun = {
  run_id: 'r-1',
  status: 'success',
  started_at: '2025-01-01T10:00:00Z',
  counts: { processed: 10, created: 5, updated: 3, noop: 2 },
} as never;

describe('MadronaSyncDrawer', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <MemoryRouter>
        <MadronaSyncDrawer isOpen={false} onClose={vi.fn()} latestRun={null} />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders drawer when isOpen=true', () => {
    render(
      <MemoryRouter>
        <MadronaSyncDrawer isOpen onClose={vi.fn()} latestRun={baseRun} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders without crashing when latestRun is null', () => {
    render(
      <MemoryRouter>
        <MadronaSyncDrawer isOpen onClose={vi.fn()} latestRun={null} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <MadronaSyncDrawer isOpen onClose={onClose} latestRun={null} />
      </MemoryRouter>,
    );
    const backdrop = container.querySelector('.drawer-backdrop');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });
});
