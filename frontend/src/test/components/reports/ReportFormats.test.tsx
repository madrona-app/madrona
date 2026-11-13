import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { ReportPdfSetting } from '../../../components/reports/ReportPdfSetting';
import * as api from '../../../lib/api/on-demand-reports';
import { sortReportFormats, reportFormatShortLabel } from '../../../lib/api/on-demand-reports';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api/on-demand-reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api/on-demand-reports')>();
  return {
    ...actual,
    getAvailableReports: vi.fn(),
    generateReport: vi.fn(),
    getReportRuns: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
    getReportPdfMode: vi.fn(),
    updateReportPdfMode: vi.fn(),
  };
});

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'org-1' }),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('format helpers', () => {
  it('orders accessible formats first', () => {
    expect(sortReportFormats(['pdf', 'excel', 'csv', 'txt', 'docx', 'html'])).toEqual([
      'html', 'docx', 'txt', 'csv', 'excel', 'pdf',
    ]);
    expect(sortReportFormats(['pdf', 'zip', 'html'])).toEqual(['html', 'pdf', 'zip']);
  });

  it('gives short labels for the runs list', () => {
    expect(reportFormatShortLabel('txt')).toBe('Text');
    expect(reportFormatShortLabel('docx')).toBe('Word');
    expect(reportFormatShortLabel('zip')).toBe('ZIP');
  });
});

describe('GenerateReportSlideOver export format', () => {
  beforeEach(() => {
    vi.mocked(api.getAvailableReports).mockResolvedValue({
      total: 1,
      reports: [
        {
          report_key: 'object_record_sheet',
          name: 'Object Record Sheet',
          description: 'Object details',
          category: 'Document Report',
          style: 'document',
          // server order deliberately scrambled: the UI orders accessible-first
          supported_formats: ['pdf', 'txt', 'docx', 'html'],
          default_format: 'pdf',
        },
      ],
    });
  });

  it('offers formats as a labelled radio group, accessible formats first', async () => {
    render(
      wrap(
        <GenerateReportSlideOver
          isOpen
          onClose={() => {}}
          contextType="record"
          contextParams={{ record_id: 'r1', record_type: 'collection_objects' }}
          recordType="collection_objects"
        />,
      ),
    );
    const group = await screen.findByRole('group', { name: 'Export format' });
    const radios = Array.from(group.querySelectorAll('input[type="radio"]')).map(
      (r) => (r as HTMLInputElement).labels?.[0]?.textContent,
    );
    expect(radios[0]).toMatch(/^Accessible web page \(HTML\)/);
    expect(radios[1]).toMatch(/^Word document/);
    expect(radios[2]).toMatch(/^Plain text/);
    expect(radios[3]).toMatch(/^PDF/);

    // the server default is preselected and announced as checked
    expect(screen.getByRole('radio', { name: 'PDF' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Plain text' }));
    expect(screen.getByRole('radio', { name: 'Plain text' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'PDF' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Accessible web page (HTML)' })).toHaveAccessibleDescription(
      /screen readers/,
    );
    expect(screen.getByRole('button', { name: /Object Record Sheet/ })).toHaveAttribute('aria-pressed', 'true');

    const results = await checkA11y(document.body);
    expect(results.violations).toEqual([]);
  });
});

describe('ReportPdfSetting', () => {
  beforeEach(() => {
    vi.mocked(api.getReportPdfMode).mockResolvedValue({ pdf_mode: 'all' });
    vi.mocked(api.updateReportPdfMode).mockResolvedValue({ pdf_mode: 'none' });
  });

  it('is a radio group that saves explicitly and announces the result', async () => {
    const { container } = render(wrap(<ReportPdfSetting organizationId="org-1" />));
    expect(await screen.findByRole('heading', { name: 'PDF reports', level: 2 })).toBeInTheDocument();
    const all = await screen.findByRole('radio', { name: 'Offer all PDF reports' });
    expect(all).toBeChecked();
    expect(screen.getByRole('group', { name: 'PDF reports to offer' })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save PDF setting' });
    expect(save).toBeDisabled();

    const none = screen.getByRole('radio', { name: 'Accessible formats only' });
    expect(none).toHaveAccessibleDescription(/HTML, Word, plain text, CSV and Excel/);
    fireEvent.click(none);
    expect(api.updateReportPdfMode).not.toHaveBeenCalled(); // choosing does not save
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.updateReportPdfMode).toHaveBeenCalledWith('org-1', 'none'));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved: Accessible formats only.');

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('announces a save failure', async () => {
    vi.mocked(api.updateReportPdfMode).mockRejectedValue(new Error('Forbidden'));
    render(wrap(<ReportPdfSetting organizationId="org-1" />));
    fireEvent.click(await screen.findByRole('radio', { name: 'Offer tagged PDF reports only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF setting' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not save: Forbidden.');
  });
});
