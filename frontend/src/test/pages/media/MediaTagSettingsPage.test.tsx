import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaTagSettingsPage from '../../../pages/media/MediaTagSettingsPage';

// Mock TagDefinitionsManager to avoid pulling in its dependencies
vi.mock('../../../components/dam', () => ({
  TagDefinitionsManager: ({ organizationId }: { organizationId: string }) => (
    <div data-testid="tag-definitions-manager">TagDefinitionsManager:{organizationId}</div>
  ),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId: string | undefined = 'org-123') {
  const queryClient = createTestQueryClient();
  const path = orgId ? `/organizations/${orgId}/media/config/tags` : '/organizations//media/config/tags';
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/config/tags"
            element={<MediaTagSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MediaTagSettingsPage', () => {
  it('renders page title', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /tag settings/i })).toBeInTheDocument();
  });

  it('renders descriptive help text about tags', () => {
    renderPage();
    expect(screen.getByText(/how tags work/i)).toBeInTheDocument();
    expect(screen.getByText(/users can assign values/i)).toBeInTheDocument();
  });

  it('renders TagDefinitionsManager with orgId', () => {
    renderPage('org-abc');
    expect(screen.getByTestId('tag-definitions-manager')).toHaveTextContent(
      'TagDefinitionsManager:org-abc'
    );
  });

});
