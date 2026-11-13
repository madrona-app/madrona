import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BrandingSettingsPage from '../../pages/collections/BrandingSettingsPage';
import * as api from '../../lib/api';
import { checkA11y } from '../a11y';

vi.mock('../../lib/api', () => ({
  getOrganizationBranding: vi.fn(),
  updateOrganizationBranding: vi.fn(),
  uploadBrandingLogo: vi.fn(),
  deleteBrandingLogo: vi.fn(),
  uploadBrandingSignature: vi.fn(),
  deleteBrandingSignature: vi.fn(),
}));

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'org-1' }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/settings/branding']}>
        <Routes>
          <Route path="/organizations/:orgId/collections/settings/branding" element={<BrandingSettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BrandingSettingsPage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getOrganizationBranding).mockResolvedValue({
      organization_id: 'org-1',
      letterhead_name: 'Museum of Art',
      primary_color: '#1a365d',
      secondary_color: '#4a5568',
      accent_color: '#3182ce',
      logo_url: null,
      signature_url: null,
    } as never);
  });

  it('has no axe violations and every text field is labelled', async () => {
    const { container } = renderPage();
    expect(await screen.findByRole('textbox', { name: 'Organization Name' })).toHaveValue('Museum of Art');
    for (const name of ['Address Line 1', 'Address Line 2', 'City, State, ZIP', 'Country', 'Phone', 'Email', 'Website', 'Footer Text', 'Signatory Name', 'Signatory Title', 'Primary Color hex value']) {
      expect(screen.getByRole('textbox', { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Primary Color')).toHaveAttribute('type', 'color');

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });
});
