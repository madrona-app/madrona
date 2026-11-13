import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthorityAutocomplete } from '../../../components/collections/AuthorityAutocomplete';
import type { AuthorityBackedValue } from '../../../components/collections/AuthorityAutocomplete';
import * as apiClientModule from '../../../lib/apiClient';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  API_BASE_URL: '/api',
  getCsrfToken: () => 'csrf',
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'org-1' }),
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

const searchResponse = {
  query: 'harb',
  suggestions: [
    {
      id: 'vocab-1',
      label: 'harbors',
      source: 'vocabulary',
      score: 0.95,
    },
    {
      id: 'lcsh-sh85058882',
      label: 'Harbors',
      description: 'Library of Congress Subject Heading',
      source: 'loc',
      score: 0.9,
      reference: { uri: 'http://id.loc.gov/authorities/subjects/sh85058882', source: 'LCSH', label: 'Harbors' },
    },
    {
      id: 'org-0',
      label: 'harbour scene',
      source: 'organization',
      score: 0.8,
    },
  ],
  external_searched: true,
  search_time_ms: 5,
};

let fetchMock: ReturnType<typeof vi.fn>;

function strictSettings(strict: boolean) {
  mockApiFetch.mockResolvedValue({
    fields: [{ key: 'subjects', label: 'Subjects', description: '', strict }],
  });
}

function renderAutocomplete(onChange = vi.fn(), value: AuthorityBackedValue | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <label htmlFor="subject-1">Subject 1</label>
      <AuthorityAutocomplete
        id="subject-1"
        fieldType="subject"
        strictField="subjects"
        value={value}
        onChange={onChange}
        debounceMs={0}
        ariaLabel="Subject 1"
      />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

async function typeAndWait(text: string) {
  const input = screen.getByRole('combobox', { name: 'Subject 1' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  await screen.findByRole('listbox');
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
  return input;
}

describe('AuthorityAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/autocomplete/select')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(searchResponse) });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes a collapsed combobox before typing', () => {
    strictSettings(false);
    renderAutocomplete();
    const input = screen.getByRole('combobox', { name: 'Subject 1' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).not.toHaveAttribute('aria-controls');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('opens a grouped listbox, announces the count, and links it to the input', async () => {
    strictSettings(false);
    renderAutocomplete();
    const input = await typeAndWait('harb');
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(screen.getByRole('group', { name: 'From your collection' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reference sources' })).toBeInTheDocument();
    // 3 suggestions + "use as entered"
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.getByRole('option', { name: /Use .harb. as entered/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('3 suggestions available');
    });
  });

  it('has no axe violations while open', async () => {
    strictSettings(false);
    renderAutocomplete();
    await typeAndWait('harb');
    // The listbox is portalled to <body>; landmark coverage is the page's job.
    const results = await checkA11y(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('moves aria-activedescendant with the arrow keys and selects with Enter', async () => {
    strictSettings(false);
    const { onChange } = renderAutocomplete();
    const input = await typeAndWait('harb');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({
      value: 'Harbors',
      authorities: [{ uri: 'http://id.loc.gov/authorities/subjects/sh85058882', source: 'LCSH', label: 'Harbors' }],
    });
  });

  it('closes on Escape and keeps focus in the input', async () => {
    strictSettings(false);
    renderAutocomplete();
    const input = await typeAndWait('harb');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveFocus();
  });

  it('lenient fields keep "use as entered"', async () => {
    strictSettings(false);
    const { onChange } = renderAutocomplete();
    const input = await typeAndWait('harb');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ value: 'harb' });
  });

  describe('when the field is strict', () => {
    it('explains the restriction as described text and drops "use as entered"', async () => {
      strictSettings(true);
      renderAutocomplete();
      const input = screen.getByRole('combobox', { name: 'Subject 1' });
      await waitFor(() => {
        expect(input).toHaveAccessibleDescription(/new terms can.t be added here/i);
      });
      await typeAndWait('harb');
      expect(screen.queryByRole('option', { name: /as entered/ })).not.toBeInTheDocument();
      // Free-text "organization" value without a reference is not offered
      expect(screen.queryByRole('option', { name: /harbour scene/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(2);
    });

    it('does not commit typed text on Enter and says why', async () => {
      strictSettings(true);
      const { onChange } = renderAutocomplete();
      const input = await typeAndWait('harb');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent(
        'New terms cannot be added to this field. Choose a suggestion from the list.',
      );
    });

    it('saves a chosen reference-source term to the vocabulary before committing', async () => {
      strictSettings(true);
      const { onChange } = renderAutocomplete();
      await typeAndWait('harb');
      fireEvent.click(screen.getByRole('option', { name: /Harbors Library of Congress Subject Heading/ }));
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      const selectCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/autocomplete/select'));
      expect(selectCall).toBeTruthy();
      const body = JSON.parse(selectCall![1].body);
      expect(body).toMatchObject({
        suggestion_id: 'lcsh-sh85058882',
        vocabulary: 'lcsh',
        external_uri: 'http://id.loc.gov/authorities/subjects/sh85058882',
        applicable_fields: ['subjects'],
      });
    });

    it('has no axe violations while open', async () => {
      strictSettings(true);
      renderAutocomplete();
      await typeAndWait('harb');
      // The listbox is portalled to <body>; landmark coverage is the page's job.
    const results = await checkA11y(document.body, { rules: { region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  });
});
