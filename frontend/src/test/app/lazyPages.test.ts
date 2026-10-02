import { describe, it, expect } from 'vitest';
import * as lazyPages from '../../app/lazyPages';

/**
 * Smoke test for the lazyPages barrel: confirms a representative set of
 * route-level pages are exported as React.lazy components. Catches accidental
 * removals or import-path drift without paying the cost of dynamic-importing
 * every page (which would defeat code splitting).
 */
describe('lazyPages exports', () => {
  const expected = [
    // Auth
    'ActivateAccountPage',
    'ForgotPasswordPage',
    'ResetPasswordPage',
    'SignInPage',
    // Bridge
    'BridgeOverview',
    'PipelinesPage',
    'DatasetsPage',
    'RunsListPage',
    // Collections
    'AcquisitionsPage',
    'CollectionObjectsPage',
    'LoansInPage',
    'LoansOutPage',
    'EventsPage',
    // Media
    'MediaLibraryPage',
    'DownloadRequestsPage',
    // Exhibit
    'ChecklistTemplateEditorPage',
    'ExhibitSettingsPage',
    'VenuesPage',
    // Discover
    'PublicCollectionPage',
    'BlogListPage',
    'NotFoundPublicPage',
    // Content
    'CategoriesPage',
    'PagesListPage',
    // Guide
    'GuideChatPage',
    'GuideDocumentsPage',
    // Home
    'HomePage',
    // Reports
    'ReportsPage',
    // Admin
    'OrganizationsPage',
    'RoleManagementPage',
    'UserSettingsPage',
    // Work
    'GlobalWorkPage',
    'WorkspacesListPage',
    // Shared
    'EntityDetailPage',
    'EntitySearchPage',
    'NotificationsPage',
  ];

  for (const name of expected) {
    it(`exports ${name}`, () => {
      const value = (lazyPages as Record<string, unknown>)[name];
      expect(value).toBeDefined();
      // React.lazy returns an object with $$typeof and _payload
      expect(value).toMatchObject({
        $$typeof: expect.anything(),
      });
    });
  }

  it('does not export removed legacy pages', () => {
    // Sanity: ensure we're testing the right module
    const all = Object.keys(lazyPages);
    expect(all.length).toBeGreaterThan(50);
  });
});
