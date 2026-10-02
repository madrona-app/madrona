import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClassificationLinker } from '../../../components/collections/ClassificationLinker';

const {
  getObjectClassificationsMock,
  linkObjectClassificationMock,
  unlinkObjectClassificationMock,
  useLookupCategoryMock,
} = vi.hoisted(() => ({
  getObjectClassificationsMock: vi.fn(),
  linkObjectClassificationMock: vi.fn(),
  unlinkObjectClassificationMock: vi.fn(),
  useLookupCategoryMock: vi.fn(),
}));

vi.mock('../../../lib/api/collections', () => ({
  getObjectClassifications: getObjectClassificationsMock,
  linkObjectClassification: linkObjectClassificationMock,
  unlinkObjectClassification: unlinkObjectClassificationMock,
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupCategory: useLookupCategoryMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderLinker(props: Partial<Parameters<typeof ClassificationLinker>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <ClassificationLinker organizationId="org-1" objectId="obj-1" {...props} />
    </QueryClientProvider>,
  );
}

describe('ClassificationLinker', () => {
  beforeEach(() => {
    getObjectClassificationsMock.mockReset();
    linkObjectClassificationMock.mockReset();
    unlinkObjectClassificationMock.mockReset();
    useLookupCategoryMock.mockReset();
    useLookupCategoryMock.mockReturnValue({ values: [] });
  });

  it('shows a loading message while fetching', () => {
    getObjectClassificationsMock.mockImplementation(() => new Promise(() => {}));
    renderLinker();
    expect(screen.getByText('Loading classifications...')).toBeInTheDocument();
  });

  it('renders nothing in read-only mode when there are no classifications', async () => {
    getObjectClassificationsMock.mockResolvedValue([]);
    const { container } = renderLinker({ isEditing: false });
    // After the query resolves, an empty linked list in read-only renders null
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders linked classifications as tags in read-only mode', async () => {
    getObjectClassificationsMock.mockResolvedValue([
      {
        link_id: 'l-1',
        value_id: 'v-1',
        lookup_value: { label: 'Painting' },
      },
      {
        link_id: 'l-2',
        value_id: 'v-2',
        lookup_value: { label: 'Sculpture' },
      },
    ]);
    renderLinker({ isEditing: false });
    await waitFor(() => screen.getByText('Painting'));
    expect(screen.getByText('Painting')).toBeInTheDocument();
    expect(screen.getByText('Sculpture')).toBeInTheDocument();
    // Header label
    expect(screen.getByText('Classifications')).toBeInTheDocument();
  });

  it('renders the add dropdown only with available (un-linked, active) options', async () => {
    getObjectClassificationsMock.mockResolvedValue([
      { link_id: 'l-1', value_id: 'v-1', lookup_value: { label: 'Painting' } },
    ]);
    useLookupCategoryMock.mockReturnValue({
      values: [
        { value_id: 'v-1', label: 'Painting', is_active: true },
        { value_id: 'v-2', label: 'Sculpture', is_active: true },
        { value_id: 'v-3', label: 'Inactive', is_active: false },
      ],
    });
    renderLinker({ isEditing: true });
    await waitFor(() => screen.getByRole('combobox'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.text);
    expect(optionLabels).toContain('Sculpture');
    expect(optionLabels).not.toContain('Painting'); // already linked
    expect(optionLabels).not.toContain('Inactive');
  });

  it('calls linkObjectClassification when an option is selected', async () => {
    getObjectClassificationsMock.mockResolvedValue([]);
    linkObjectClassificationMock.mockResolvedValue({});
    useLookupCategoryMock.mockReturnValue({
      values: [{ value_id: 'v-2', label: 'Sculpture', is_active: true }],
    });
    renderLinker({ isEditing: true });
    await waitFor(() => screen.getByRole('combobox'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'v-2' } });
    await waitFor(() =>
      expect(linkObjectClassificationMock).toHaveBeenCalledWith('org-1', 'obj-1', {
        value_id: 'v-2',
      }),
    );
  });

  it('calls unlinkObjectClassification when the X is clicked on a tag', async () => {
    getObjectClassificationsMock.mockResolvedValue([
      { link_id: 'l-9', value_id: 'v-1', lookup_value: { label: 'Painting' } },
    ]);
    unlinkObjectClassificationMock.mockResolvedValue({});
    useLookupCategoryMock.mockReturnValue({ values: [] });
    renderLinker({ isEditing: true });
    await waitFor(() => screen.getByText('Painting'));
    // The remove button is the only button rendered in the tag
    const removeButton = screen
      .getByText('Painting')
      .closest('span')
      ?.querySelector('button') as HTMLButtonElement;
    fireEvent.click(removeButton);
    await waitFor(() =>
      expect(unlinkObjectClassificationMock).toHaveBeenCalledWith('org-1', 'obj-1', 'l-9'),
    );
  });
});
