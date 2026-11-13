/**
 * Subjects field with the real AuthorityAutocomplete: choosing a Library of
 * Congress Subject Heading stores its LCSH URI as the subject's authority link.
 * HTTP is mocked; no request reaches id.loc.gov.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SubjectsField } from '../../../../components/collections/ObjectFieldComponents/SubjectsField';
import { referenceSourceForUri } from '../../../../components/collections/AuthorityAutocomplete/api';
import * as apiClientModule from '../../../../lib/apiClient';
import { checkA11y } from '../../../a11y';

vi.mock('../../../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  API_BASE_URL: '/api',
  getCsrfToken: () => 'csrf',
}));

vi.mock('../../../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'org-1' }),
}));

const LCSH_URI = 'http://id.loc.gov/authorities/subjects/sh85014832';

const searchResponse = {
  query: 'blind',
  suggestions: [
    {
      id: 'lcsh-sh85014832',
      label: 'Blind',
      description: 'Library of Congress Subject Heading',
      source: 'loc',
      score: 0.88,
      reference: { uri: LCSH_URI, source: 'LCSH', label: 'Blind', match_confidence: 'exact' },
    },
  ],
  external_searched: true,
  search_time_ms: 3,
};

function renderField(subjects = [{ term: '', type: null, vocabulary_term_id: null }]) {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SubjectsField
        subjects={subjects}
        isEditing
        onChange={onChange}
        onAdd={vi.fn()}
        onSave={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

describe('SubjectsField with Library of Congress Subject Headings', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(apiClientModule.apiFetch).mockResolvedValue({ fields: [] });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(searchResponse) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers an LCSH heading and stores its URI as the authority link', async () => {
    const { onChange } = renderField();
    const input = screen.getByRole('combobox', { name: 'Subject 1' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'blind' } });

    const option = await screen.findByRole('option', { name: /Blind.*Library of Congress/ });
    expect(screen.getByRole('group', { name: 'Reference sources' })).toContainElement(option);

    // The subject search asked the backend for external (incl. LCSH) results
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ query: 'blind', field_type: 'subject' });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toEqual([
      { term: 'Blind', type: null, vocabulary_term_id: LCSH_URI },
    ]);
  });

  it('shows a saved LCSH subject as verified', () => {
    renderField([{ term: 'Blind', type: null, vocabulary_term_id: LCSH_URI }]);
    const input = screen.getByRole('combobox', { name: 'Subject 1' });
    expect(input).toHaveAccessibleDescription(/Verified in reference sources/);
    expect(referenceSourceForUri(LCSH_URI)).toBe('LCSH');
  });

  it('has no axe violations with the suggestion list open', async () => {
    renderField();
    const input = screen.getByRole('combobox', { name: 'Subject 1' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'blind' } });
    await screen.findByRole('option', { name: /Blind/ });
    const results = await checkA11y(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
