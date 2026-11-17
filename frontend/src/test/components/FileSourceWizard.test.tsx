import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import FileSourceWizard from '../../components/FileSourceWizard';
import type { ConnectorFilePreview } from '../../lib/api';
import type { ConnectorDefinition } from '../../lib/schemas';
import { checkA11y } from '../a11y';

const api = vi.hoisted(() => ({
  previewConnectorFile: vi.fn(),
  createConnectorInstance: vi.fn(),
}));
vi.mock('../../lib/api', () => api);

const definition = {
  connector_definition_id: 'def-1',
  key: 'file-upload',
  display_name: 'Spreadsheet file (CSV or Excel)',
  direction: 'source',
  category: 'file',
} as unknown as ConnectorDefinition;

const targets = [
  { key: 'object_number', label: 'Object number' },
  { key: 'title', label: 'Title' },
  { key: 'object_name', label: 'Object name' },
  { key: 'description', label: 'Description' },
  { key: 'creator', label: 'Creator' },
  { key: 'dated', label: 'Date' },
  { key: 'notes', label: 'Notes' },
];

function makePreview(over: Partial<ConnectorFilePreview> = {}): ConnectorFilePreview {
  return {
    storage_key: 'orgs/org-1/bridge/uploads/20261113_abc.xlsx',
    filename: 'nfb-sample.xlsx',
    file_format: 'xlsx',
    size_bytes: 20480,
    sheets: ['Objects', 'People'],
    sheet_name: 'Objects',
    header_row: 1,
    encoding: null,
    delimiter: null,
    columns: ['Accession No.', 'Title', 'Notes'],
    total_rows: 2,
    preview_rows: [
      { row_number: 2, values: { 'Accession No.': 'NFB.1', Title: 'Perkins brailler', Notes: null } },
      { row_number: 3, values: { 'Accession No.': 'NFB.2', Title: 'Slate', Notes: 'Gift' } },
    ],
    suggested_mapping: { object_number: 'Accession No.', title: 'Title', notes: 'Notes' },
    mapping_targets: targets,
    limits: { max_file_bytes: 26214400, max_rows: 50000, max_columns: 500 },
    ...over,
  };
}

function renderWizard(onComplete = vi.fn()) {
  return render(
    <FileSourceWizard definition={definition} organizationId="org-1" onComplete={onComplete} onCancel={vi.fn()} />,
  );
}

function chooseFile(name = 'nfb-sample.xlsx') {
  const input = screen.getByLabelText('Spreadsheet file');
  const file = new File(['x'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  api.previewConnectorFile.mockReset();
  api.createConnectorInstance.mockReset();
});

describe('FileSourceWizard', () => {
  it('is a labelled dialog whose file input states the accepted types, with no axe violations', async () => {
    const { container } = renderWizard();
    expect(screen.getByRole('dialog', { name: 'Upload a spreadsheet' })).toBeInTheDocument();
    const input = screen.getByLabelText('Spreadsheet file');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', expect.stringContaining('.xlsx'));
    expect(input).toHaveAccessibleDescription(/Accepted types: CSV \(\.csv, \.tsv\) or Excel workbook \(\.xlsx\)/);
    expect(screen.getByRole('button', { name: 'Upload and preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close upload dialog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create source' })).toBeDisabled();
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('uploads, announces the result, moves focus to the preview, and renders an accessible table', async () => {
    api.previewConnectorFile.mockImplementation(async (_req: unknown, onProgress?: (n: number) => void) => {
      onProgress?.(0.5);
      return makePreview();
    });
    const { container } = renderWizard();
    const file = chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }));

    const heading = await screen.findByRole('heading', { name: 'Preview of nfb-sample.xlsx' });
    expect(api.previewConnectorFile).toHaveBeenCalledWith({ organizationId: 'org-1', file }, expect.any(Function));
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent(
      'Read nfb-sample.xlsx, sheet Objects: 2 rows and 3 columns. Preview below.',
    );

    const table = screen.getByRole('table', { name: 'First 2 of 2 rows from sheet Objects' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Row', 'Accession No.', 'Title', 'Notes']);
    expect(within(table).getAllByRole('columnheader')[1]).toHaveAttribute('scope', 'col');
    expect(within(table).getByRole('rowheader', { name: '2' })).toHaveAttribute('scope', 'row');
    expect(screen.getByRole('list', { name: '3 detected columns' })).toBeInTheDocument();

    expect(screen.getByLabelText('Sheet')).toHaveValue('Objects');
    expect(screen.getByRole('combobox', { name: 'Object number (required)' })).toHaveValue('Accession No.');
    expect(screen.getByRole('combobox', { name: 'Title' })).toHaveValue('Title');
    expect(screen.getByLabelText('Source name')).toHaveValue('nfb-sample');

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('re-reads another sheet from the stored upload without uploading again', async () => {
    api.previewConnectorFile
      .mockResolvedValueOnce(makePreview())
      .mockResolvedValueOnce(makePreview({
        sheet_name: 'People', columns: ['Name'], total_rows: 1,
        preview_rows: [{ row_number: 2, values: { Name: 'Jacobus tenBroek' } }],
        suggested_mapping: {},
      }));
    renderWizard();
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }));
    await screen.findByLabelText('Sheet');
    fireEvent.change(screen.getByLabelText('Sheet'), { target: { value: 'People' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));
    await screen.findByRole('table', { name: 'First 1 of 1 rows from sheet People' });
    expect(api.previewConnectorFile).toHaveBeenLastCalledWith({
      organizationId: 'org-1',
      storageKey: 'orgs/org-1/bridge/uploads/20261113_abc.xlsx',
      sheetName: 'People',
      headerRow: 1,
    });
  });

  it('shows upload errors as an alert tied to the file input', async () => {
    api.previewConnectorFile.mockRejectedValue(new Error('Legacy .xls workbooks are not supported.'));
    renderWizard();
    chooseFile('old.xls');
    fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Legacy .xls workbooks are not supported.');
    const input = screen.getByLabelText('Spreadsheet file');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Legacy .xls workbooks are not supported.'));
  });

  it('requires an object number column, then creates the source with the chosen mapping', async () => {
    api.previewConnectorFile.mockResolvedValue(makePreview({ suggested_mapping: { title: 'Title' } }));
    api.createConnectorInstance.mockResolvedValue({ connector_instance_id: 'inst-9', name: 'nfb-sample' });
    const onComplete = vi.fn();
    renderWizard(onComplete);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }));
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Create source' }));
    const select = screen.getByRole('combobox', { name: 'Object number (required)' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the column that holds the object number.');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveFocus();
    expect(api.createConnectorInstance).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: 'Accession No.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create source' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('inst-9'));
    expect(api.createConnectorInstance).toHaveBeenCalledWith({
      organization_id: 'org-1',
      connector_definition_id: 'def-1',
      name: 'nfb-sample',
      config: {
        storage_key: 'orgs/org-1/bridge/uploads/20261113_abc.xlsx',
        filename: 'nfb-sample.xlsx',
        file_format: 'xlsx',
        sheet_name: 'Objects',
        header_row: 1,
        record_type: 'Object',
        field_mapping: { title: 'Title', object_number: 'Accession No.' },
      },
    });
  });
});
