import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RelatedProcedures } from '../../components/collections/RelatedProcedures';

const { getObjectProceduresMock } = vi.hoisted(() => ({
  getObjectProceduresMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getObjectProcedures: getObjectProceduresMock,
}));

function makeProcedures(overrides: Record<string, unknown> = {}) {
  return {
    acquisitions: [],
    loans_out: [],
    conservation: [],
    condition_reports: [],
    deaccessions: [],
    use_requests: [],
    incident_reports: [],
    ...overrides,
  };
}

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderRelated(props: Partial<Parameters<typeof RelatedProcedures>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <RelatedProcedures
          organizationId="org-1"
          objectId="obj-1"
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('RelatedProcedures', () => {
  beforeEach(() => {
    getObjectProceduresMock.mockReset();
  });

  it('shows the loader while fetching', () => {
    // Pending promise
    getObjectProceduresMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderRelated();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows an error message when the fetch fails', async () => {
    getObjectProceduresMock.mockRejectedValue(new Error('boom'));
    renderRelated();
    await waitFor(() => {
      expect(screen.getByText('Failed to load procedures')).toBeInTheDocument();
    });
  });

  it('renders all procedure section headings', async () => {
    getObjectProceduresMock.mockResolvedValue(makeProcedures());
    renderRelated();
    await waitFor(() => {
      expect(screen.getByText('Acquisitions')).toBeInTheDocument();
    });
    expect(screen.getByText('Loans Out')).toBeInTheDocument();
    expect(screen.getByText('Conservation')).toBeInTheDocument();
    expect(screen.getByText('Condition Reports')).toBeInTheDocument();
    expect(screen.getByText('Deaccessions')).toBeInTheDocument();
    expect(screen.getByText('Use Requests')).toBeInTheDocument();
    expect(screen.getByText('Incident Reports')).toBeInTheDocument();
  });

  it('shows the count badge for sections with items and renders the linked record', async () => {
    getObjectProceduresMock.mockResolvedValue(
      makeProcedures({
        acquisitions: [
          {
            acquisition_id: 'a-1',
            acquisition_number: 'ACQ-2024-001',
            acquisition_method: 'gift',
            source_name: 'Jane Donor',
            acquisition_date: '2024-05-12',
            status: 'approved',
          },
        ],
      }),
    );
    renderRelated();
    await waitFor(() => {
      expect(screen.getByText('ACQ-2024-001')).toBeInTheDocument();
    });
    // Count chip "1" — present at least once
    const link = screen.getByText('ACQ-2024-001').closest('a');
    expect(link).toHaveAttribute('href', '/organizations/org-1/collections/acquisitions/a-1');
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('collapses sections that have no items by default', async () => {
    getObjectProceduresMock.mockResolvedValue(makeProcedures());
    renderRelated();
    await waitFor(() => {
      expect(screen.getByText('Acquisitions')).toBeInTheDocument();
    });
    // Empty sections render their toggle button only — empty message text not visible by default
    expect(screen.queryByText('No acquisition records')).not.toBeInTheDocument();
  });

  it('expands an empty section when its header is clicked, showing the empty message', async () => {
    getObjectProceduresMock.mockResolvedValue(makeProcedures());
    renderRelated();
    await waitFor(() => {
      expect(screen.getByText('Acquisitions')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Acquisitions'));
    expect(screen.getByText('No acquisition records')).toBeInTheDocument();
  });

  it('renders incident report rows with formatted incident type and link', async () => {
    getObjectProceduresMock.mockResolvedValue(
      makeProcedures({
        incident_reports: [
          {
            report_id: 'i-1',
            report_number: 'IR-2024-007',
            incident_type: 'damage',
            incident_date: '2024-04-01',
            status: 'open',
          },
        ],
      }),
    );
    renderRelated();
    await waitFor(() => {
      expect(screen.getByText('IR-2024-007')).toBeInTheDocument();
    });
    const link = screen.getByText('IR-2024-007').closest('a');
    expect(link).toHaveAttribute('href', '/organizations/org-1/collections/incidents/i-1');
    expect(screen.getByText('open')).toBeInTheDocument();
  });
});
