import React, { Suspense, useLayoutEffect, type ReactNode } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';

import { RouteGroupBoundary, AppAccessGuard, NotFoundPage, PageLoadingFallback } from './guards';
import { workBasePath, resolveWorkProductId } from '../hooks/useActiveProduct';

/**
 * Legacy /guide/plans(/:planId) deep-links now live in a product's Work area.
 * Resolve to the last active product's Work so the sidebar stays in-context
 * instead of bouncing into the Guide app (active product is URL-derived).
 */
function RedirectGuidePlans() {
  const { orgId, planId } = useParams();
  const { search } = useLocation();
  const base = workBasePath(orgId ?? '', resolveWorkProductId());
  const to = planId ? `${base}/plans/${planId}${search}` : `${base}/plans${search}`;
  return <Navigate to={to} replace />;
}

function RedirectGuideDrafts() {
  const { orgId } = useParams();
  const { search } = useLocation();
  const base = workBasePath(orgId ?? '', resolveWorkProductId());
  return <Navigate to={`${base}/drafts${search}`} replace />;
}
// LayoutWrapper is lazy — it transitively pulls AppShell + sidebar + contexts
// + every authed-shell component. Keeping it off the static import graph
// prevents Rollup from hoisting those into a shared chunk between main and
// admin entries. The <Suspense> wrapping <Routes> below catches suspension
// on the first navigation into an authed route.
const LayoutWrapper = React.lazy(() => import('./LayoutWrapper'));

/**
 * Scrolls to top on mount and forces remount when URL params change
 * (e.g. navigating between records) so component state doesn't bleed.
 */
function RemountOnParams({ children }: { children: ReactNode }) {
  const params = useParams();
  const key = Object.values(params).join('/');

  // Scroll to top on mount — the app scrolls inside .app-shell-content, not the window
  useLayoutEffect(() => {
    const el = document.querySelector('.app-shell-content');
    if (el) el.scrollTop = 0;
  }, []);

  return <Suspense fallback={<PageLoadingFallback />} key={key}>{children}</Suspense>;
}
import {
  RedirectToOrg,
  RedirectToOrgRuns,
  RedirectToOrgSearch,
  OrgDefaultRedirect,
  RedirectGlobalWork,
  RedirectGlobalWorkWorkspaces,
  RedirectGlobalWorkWorkspaceDetail,
  RedirectGlobalWorkWorkspaceEdit,
} from './redirects';

// All route-level pages are lazy-loaded. See ./lazyPages for the registry
// and the rule about direct-file imports (barrel imports defeat splitting).
import {
  // Auth
  AccountSecurityPage,
  ActivateAccountPage,
  InstallPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  RecoverMfaPage,
  SignInPage,
  // Bridge
  BridgeOverview,
  ConnectorsPage,
  DatasetDetailPage,
  DatasetsPage,
  PipelineDetailPage,
  PipelinesPage,
  ProjectionConfigPage,
  RunDetailPage,
  RunsListPage,
  SettingsPage,
  SetupDatasetsPage,
  SetupPage,
  SetupRunsPage,
  SetupWizardPage,
  // Collections — list & settings
  AcquisitionsPage,
  AuditCampaignsPage,
  BarcodeLabelsPage,
  BarcodeScannerPage,
  BarcodeScansPage,
  BrandingSettingsPage,
  CollectionScopeSettingsPage,
  CitationsPage,
  CollectionLocationsPage,
  CollectionObjectsPage,
  CollectionsConfigPage,
  CollectionsGeneralSettingsPage,
  CollectionsReviewsPage,
  ConditionReportsPage,
  ConservationPage,
  ConstituentsPage,
  DeaccessionsPage,
  DiscoverSettingsPage,
  ProcedureEnforcementSettingsPage,
  MediaRightsEnforcementSettingsPage,
  EmergencyPlansPage,
  EventsPage,
  ExhibitionsPage,
  IncidentReportsPage,
  IndemnityArrangementsPage,
  InsurancePage,
  LoansInPage,
  LoansOutPage,
  LookupValuesPage,
  CollectionMovementsPage,
  ObjectEntriesPage,
  ObjectExitsPage,
  RightsPage as CollectionRightsPage,
  ReportTemplatesSettingsPage,
  ShipmentsPage,
  ReproductionRequestsPage,
  RiskOverviewPage,
  UseRequestsPage,
  ValuationsPage,
  VocabularyExplorerPage,
  // Collections — workspace (detail)
  AcquisitionWorkspacePage,
  AuditCampaignWorkspacePage,
  BarcodeLabelWorkspacePage,
  CitationWorkspacePage,
  CollectionObjectWorkspacePage,
  CollectionsReviewWorkspacePage,
  ConditionReportWorkspacePage,
  ConservationWorkspacePage,
  ConstituentWorkspacePage,
  CrateWorkspacePage,
  DeaccessionWorkspacePage,
  DocumentationPlanWorkspacePage,
  EmergencyPlanWorkspacePage,
  EventWorkspacePage,
  ExhibitionWorkspacePage,
  IncidentReportWorkspacePage,
  IndemnityArrangementWorkspacePage,
  InsuranceWorkspacePage,
  LoanInWorkspacePage,
  LoanOutWorkspacePage,
  MovementWorkspacePage,
  ObjectEntryWorkspacePage,
  ObjectExitWorkspacePage,
  PlaceAuthorityWorkspacePage,
  ReproductionRequestWorkspacePage,
  RightWorkspacePage,
  ShipmentWorkspacePage,
  StylePeriodAuthorityWorkspacePage,
  SubjectAuthorityWorkspacePage,
  UseRequestWorkspacePage,
  ValuationWorkspacePage,
  // Media (DAM)
  DownloadRequestsPage,
  DownloadRequestWorkspacePage,
  MediaAIConfigPage,
  MediaAnalyticsPage,
  MediaCollectionDetailPage,
  MediaCollectionsPage,
  MyLightboxSharesPage,
  MediaConfigPage,
  MediaDerivativeSettingsPage,
  MediaDetailPage,
  MediaAnnotationsPage,
  MediaTransformPage,
  MediaRightsPage,
  MediaPreservationPage,
  MediaAIPage,
  MediaHistoryPage,
  MediaFieldInheritanceSettingsPage,
  MediaLibraryPage,
  MediaPreservationDashboardPage,
  MediaPublishingPage,
  MediaTagSettingsPage,
  MetadataReviewPage,
  MetadataTemplatesPage,
  MyDownloadRequestsPage,
  ProcessingJobsPage,
  WatermarkTemplatesPage,
  // Exhibit
  ChecklistTemplateEditorPage,
  ChecklistTemplatesPage,
  ExhibitSettingsPage,
  LabelTemplatesPage,
  VenuesPage,
  // Discover (public)
  BlogListPage,
  BlogPostPage,
  ContentPage,
  DiscoverObjectPage,
  DiscoverPage,
  EventDetailPublicPage,
  EventListPublicPage,
  ExhibitionDetailPublicPage,
  ExhibitionListPublicPage,
  NotFoundPublicPage,
  PublicCollectionPage,
  VenueDetailPage,
  VenueListPage,
  // Content CMS
  CategoriesPage,
  ContentSiteSettingsPage,
  PageEditorPage,
  PagesListPage,
  PostsListPage,
  // Guide
  GuideChatPage,
  GuideDocumentsPage,
  GuideWidgetPage,
  GuideQrKitPage,
  GuideVisitorInsightsPage,
  GuideStandalonePage,
  // Home
  HomePage,
  RecentActivityPage,
  // Reports
  ReportsPage,
  // Admin
  APIKeysPage,
  AppSubscriptionsPage,
  BulkUserImportPage,
  DepartmentManagementPage,
  EntityAuditPage,
  LogsPage,
  OrganizationsPage,
  OrganizationUsersPage,
  PermissionManagementPage,
  ProvisioningJobDetailPage,
  RelationshipDefinitionsPage,
  RoleManagementPage,
  OrganizationApplicationsPage,
  SSOConfigurationPage,
  StorageConfigPage,
  UserSettingsPage,
  // Work
  ApprovalsPage,
  AgentPlansPage,
  PlanDetailPage,
  DraftsInboxPage,
  GlobalWorkPage,
  WorkspaceCreatePage,
  WorkspaceDetailPage,
  WorkspaceEditPage,
  WorkspacesListPage,
  // Shared
  EntityDetailPage,
  EntitySearchPage,
  NotificationsPage,
} from './lazyPages';

export function AppRoutes() {
  return (
    // Top-level Suspense catches lazy routes that live outside LayoutWrapper
    // (auth, public gallery, public /c/:orgSlug discover). Routes under
    // LayoutWrapper have their own nested Suspense (see guards.tsx), which
    // takes precedence and avoids unmounting the layout shell on navigation.
    <Suspense fallback={<PageLoadingFallback />}>
    <Routes>
      {/* Auth routes - public, no layout */}
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/recover-mfa" element={<RecoverMfaPage />} />
      <Route path="/activate" element={<ActivateAccountPage />} />
      {/* First-run install. Public by necessity — it runs before any
          account exists — and refuses once an organization is present. */}
      <Route path="/install" element={<InstallPage />} />
      <Route path="/account/security" element={<AccountSecurityPage />} />

      {/* Public gallery - no auth required */}

      {/* Shared lightbox (token-scoped, optional password) - no auth required */}
      <Route path="/share/collection/:token" element={<Suspense fallback={<PageLoadingFallback />}><PublicCollectionPage /></Suspense>} />

      {/* Public collection discover - no auth required */}
      <Route path="/c/:orgSlug" element={<DiscoverPage />} />
      <Route path="/c/:orgSlug/objects/:objectId" element={<DiscoverObjectPage />} />
      <Route path="/c/:orgSlug/guide" element={<Suspense fallback={<PageLoadingFallback />}><GuideStandalonePage /></Suspense>} />
      <Route path="/c/:orgSlug/pages/:pageSlug" element={<Suspense fallback={<PageLoadingFallback />}><ContentPage /></Suspense>} />
      <Route path="/c/:orgSlug/blog" element={<Suspense fallback={<PageLoadingFallback />}><BlogListPage /></Suspense>} />
      <Route path="/c/:orgSlug/blog/:postSlug" element={<Suspense fallback={<PageLoadingFallback />}><BlogPostPage /></Suspense>} />
      {/* Public venue/exhibition/event pages (Phase 3-5) */}
      <Route path="/c/:orgSlug/visit" element={<Suspense fallback={<PageLoadingFallback />}><VenueListPage /></Suspense>} />
      <Route path="/c/:orgSlug/visit/:venueSlug" element={<Suspense fallback={<PageLoadingFallback />}><VenueDetailPage /></Suspense>} />
      <Route path="/c/:orgSlug/exhibitions" element={<Suspense fallback={<PageLoadingFallback />}><ExhibitionListPublicPage /></Suspense>} />
      <Route path="/c/:orgSlug/exhibitions/:slug" element={<Suspense fallback={<PageLoadingFallback />}><ExhibitionDetailPublicPage /></Suspense>} />
      <Route path="/c/:orgSlug/events" element={<Suspense fallback={<PageLoadingFallback />}><EventListPublicPage /></Suspense>} />
      <Route path="/c/:orgSlug/events/:slug" element={<Suspense fallback={<PageLoadingFallback />}><EventDetailPublicPage /></Suspense>} />
      {/* Public 404 catch-all for discover site */}
      <Route path="/c/:orgSlug/*" element={<Suspense fallback={<PageLoadingFallback />}><NotFoundPublicPage /></Suspense>} />

      {/* Legacy routes - redirect to org-scoped routes */}
      <Route path="/" element={<RedirectToOrg />} />
      <Route path="/runs" element={<RedirectToOrgRuns />} />
      <Route path="/entities" element={<RedirectToOrgSearch />} />
      {/* Org-scoped routes with Layout */}
      <Route element={<LayoutWrapper />}>
        {/* ============================================================ */}
        {/* GLOBAL WORK REDIRECTS - redirect to active product's work   */}
        {/* ============================================================ */}
        <Route path="/organizations/:orgId/work" element={<RedirectGlobalWork />} />
        <Route path="/organizations/:orgId/work/tasks" element={<RedirectGlobalWork />} />
        <Route path="/organizations/:orgId/work/recent" element={<RedirectGlobalWork />} />
        <Route path="/organizations/:orgId/work/actions" element={<RedirectGlobalWork />} />
        <Route path="/organizations/:orgId/work/workspaces" element={<RedirectGlobalWorkWorkspaces />} />
        <Route path="/organizations/:orgId/work/workspaces/new" element={<RedirectGlobalWorkWorkspaces />} />
        <Route path="/organizations/:orgId/work/workspaces/:workspaceId/edit" element={<RedirectGlobalWorkWorkspaceEdit />} />
        <Route path="/organizations/:orgId/work/workspaces/:workspaceId" element={<RedirectGlobalWorkWorkspaceDetail />} />
        {/* Bridge routes */}
        <Route element={<AppAccessGuard name="Bridge" appKey="bridge" />}>
          <Route path="/organizations/:orgId/bridge" element={<BridgeOverview />} />
          <Route path="/organizations/:orgId/bridge/setup" element={<SetupPage />}>
            <Route index element={<SetupWizardPage />} />
            <Route path="datasets" element={<SetupDatasetsPage />} />
            <Route path="display-fields" element={<ProjectionConfigPage />} />
            <Route path="connectors" element={<ConnectorsPage />} />
            <Route path="connectors/:instanceId" element={<SettingsPage />} />
            <Route path="pipelines" element={<PipelinesPage />} />
            <Route path="pipelines/:pipelineId" element={<PipelineDetailPage />} />
            <Route path="runs" element={<SetupRunsPage />} />
            <Route path="relationships" element={<RelationshipDefinitionsPage />} />
          </Route>
          <Route path="/organizations/:orgId/bridge/runs" element={<RunsListPage />} />
          <Route path="/organizations/:orgId/bridge/runs/:runId" element={<RunDetailPage />} />
          <Route path="/organizations/:orgId/bridge/reports" element={<ReportsPage />} />
          <Route path="/organizations/:orgId/bridge/datasets" element={<DatasetsPage />} />
          <Route path="/organizations/:orgId/bridge/datasets/:datasetId" element={<DatasetDetailPage />} />
          <Route path="/organizations/:orgId/bridge/search" element={<EntitySearchPage />} />
          <Route path="/organizations/:orgId/bridge/entities/:entityKey" element={<EntityDetailPage />} />
        </Route>
        {/* Legacy Bridge route redirects */}
        <Route path="/organizations/:orgId/setup/*" element={<Navigate to="../bridge/setup" replace />} />
        <Route path="/organizations/:orgId/runs" element={<Navigate to="../bridge/runs" replace />} />
        <Route path="/organizations/:orgId/datasets" element={<Navigate to="../bridge/datasets" replace />} />
        <Route path="/organizations/:orgId/search" element={<Navigate to="../bridge/search" replace />} />
        <Route path="/organizations/:orgId/entities/*" element={<Navigate to="../bridge/entities" replace />} />
        <Route path="/organizations/:orgId/home" element={<HomePage />} />
        <Route path="/organizations/:orgId/recent" element={<RecentActivityPage />} />
        <Route path="/organizations/:orgId/settings" element={<UserSettingsPage />} />
        <Route path="/organizations/:orgId/notifications" element={<NotificationsPage />} />
        <Route element={<RouteGroupBoundary name="Admin" />}>
          <Route path="/organizations/:orgId/admin/users" element={<OrganizationUsersPage />} />
          <Route path="/organizations/:orgId/admin/departments" element={<DepartmentManagementPage />} />
          <Route path="/organizations/:orgId/admin/roles" element={<RoleManagementPage />} />
          <Route path="/organizations/:orgId/admin/applications" element={<OrganizationApplicationsPage />} />
          <Route path="/organizations/:orgId/admin/relationships" element={<RelationshipDefinitionsPage />} />
          <Route path="/organizations/:orgId/admin/app-subscriptions" element={<AppSubscriptionsPage />} />
          <Route path="/organizations/:orgId/admin/storage-config" element={<StorageConfigPage />} />
          <Route path="/organizations/:orgId/admin/organizations" element={<OrganizationsPage />} />
          <Route path="/organizations/:orgId/admin/provision-jobs/:jobId" element={<ProvisioningJobDetailPage />} />
          <Route path="/organizations/:orgId/admin/logs" element={<LogsPage />} />
          <Route path="/organizations/:orgId/admin/bulk-import" element={<BulkUserImportPage />} />
          <Route path="/organizations/:orgId/admin/sso" element={<SSOConfigurationPage />} />

          <Route path="/organizations/:orgId/admin/entity-audit" element={<EntityAuditPage />} />
          <Route path="/organizations/:orgId/admin/api-keys" element={<APIKeysPage />} />
          <Route path="/organizations/:orgId/admin/permissions" element={<PermissionManagementPage />} />
        </Route>
        {/* Collections routes */}
        <Route element={<AppAccessGuard name="Collections" appKey="collections" />}>
        {/* Collections Work routes */}
        <Route path="/organizations/:orgId/collections/work" element={<GlobalWorkPage />} />
        <Route path="/organizations/:orgId/collections/work/workspaces" element={<WorkspacesListPage />} />
        <Route path="/organizations/:orgId/collections/work/approvals" element={<ApprovalsPage />} />
        <Route path="/organizations/:orgId/collections/work/workspaces/new" element={<WorkspaceCreatePage />} />
        <Route path="/organizations/:orgId/collections/work/workspaces/:workspaceId/edit" element={<WorkspaceEditPage />} />
        <Route path="/organizations/:orgId/collections/work/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
        <Route path="/organizations/:orgId/collections/objects" element={<CollectionObjectsPage />} />
        <Route path="/organizations/:orgId/collections/objects/create" element={<RemountOnParams><CollectionObjectWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/objects/:objectId" element={<RemountOnParams><CollectionObjectWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/objects/:objectId/edit" element={<RemountOnParams><CollectionObjectWorkspacePage /></RemountOnParams>} />
        {/* Collections Reports */}
        {/* Collections configuration with nested routes */}
        <Route path="/organizations/:orgId/collections/config" element={<CollectionsConfigPage />}>
          <Route index element={<CollectionsGeneralSettingsPage />} />
          <Route path="locations" element={<CollectionLocationsPage />} />
          <Route path="lookup-values" element={<LookupValuesPage />} />
          <Route path="branding" element={<BrandingSettingsPage />} />
          <Route path="scope" element={<CollectionScopeSettingsPage />} />
          <Route path="report-templates" element={<ReportTemplatesSettingsPage />} />
          <Route path="discover" element={<DiscoverSettingsPage />} />
          <Route path="procedure" element={<ProcedureEnforcementSettingsPage />} />
        </Route>
        {/* Media Library (DAM) */}
        <Route path="/organizations/:orgId/collections/media" element={<MediaLibraryPage />} />
        {/* Collection Movements (list demoted from nav — detail pages kept) */}
        <Route path="/organizations/:orgId/collections/movements" element={<CollectionMovementsPage />} />
        <Route path="/organizations/:orgId/collections/movements/create" element={<RemountOnParams><MovementWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/movements/:movementId" element={<RemountOnParams><MovementWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/movements/:movementId/edit" element={<RemountOnParams><MovementWorkspacePage /></RemountOnParams>} />
        {/* Shipments (list demoted from nav — detail pages kept) */}
        <Route path="/organizations/:orgId/collections/shipments" element={<ShipmentsPage />} />
        <Route path="/organizations/:orgId/collections/shipments/create" element={<RemountOnParams><ShipmentWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/shipments/:shipmentId" element={<RemountOnParams><ShipmentWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/shipments/:shipmentId/edit" element={<RemountOnParams><ShipmentWorkspacePage /></RemountOnParams>} />
        {/* Crates (list demoted from nav — detail pages kept) */}
        <Route path="/organizations/:orgId/collections/crates/create" element={<RemountOnParams><CrateWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/crates/:crateId" element={<RemountOnParams><CrateWorkspacePage /></RemountOnParams>} />
        {/* Barcodes & Inventory */}
        <Route path="/organizations/:orgId/collections/barcodes/labels" element={<BarcodeLabelsPage />} />
        <Route path="/organizations/:orgId/collections/barcodes/labels/create" element={<RemountOnParams><BarcodeLabelWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/barcodes/labels/:labelId" element={<RemountOnParams><BarcodeLabelWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/barcodes/labels/:labelId/edit" element={<RemountOnParams><BarcodeLabelWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/barcodes/scans" element={<BarcodeScansPage />} />
        <Route path="/organizations/:orgId/collections/barcodes/scanner" element={<BarcodeScannerPage />} />
        {/* procedure routes */}
        <Route path="/organizations/:orgId/collections/constituents" element={<ConstituentsPage />} />
        <Route path="/organizations/:orgId/collections/constituents/create" element={<RemountOnParams><ConstituentWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/constituents/:constituentId" element={<RemountOnParams><ConstituentWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/constituents/:constituentId/edit" element={<RemountOnParams><ConstituentWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/condition-reports" element={<ConditionReportsPage />} />
        <Route path="/organizations/:orgId/collections/condition-reports/create" element={<RemountOnParams><ConditionReportWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/condition-reports/:reportId" element={<RemountOnParams><ConditionReportWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/condition-reports/:reportId/edit" element={<RemountOnParams><ConditionReportWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/entries" element={<ObjectEntriesPage />} />
        <Route path="/organizations/:orgId/collections/entries/create" element={<RemountOnParams><ObjectEntryWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/entries/:entryId" element={<RemountOnParams><ObjectEntryWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/entries/:entryId/edit" element={<RemountOnParams><ObjectEntryWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/acquisitions" element={<AcquisitionsPage />} />
        <Route path="/organizations/:orgId/collections/acquisitions/create" element={<RemountOnParams><AcquisitionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/acquisitions/:acquisitionId" element={<RemountOnParams><AcquisitionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/acquisitions/:acquisitionId/edit" element={<RemountOnParams><AcquisitionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/loans-in" element={<LoansInPage />} />
        <Route path="/organizations/:orgId/collections/loans-in/create" element={<RemountOnParams><LoanInWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/loans-in/:loanId" element={<RemountOnParams><LoanInWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/loans-in/:loanId/edit" element={<RemountOnParams><LoanInWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/loans-out" element={<LoansOutPage />} />
        <Route path="/organizations/:orgId/collections/loans-out/create" element={<RemountOnParams><LoanOutWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/loans-out/:loanId" element={<RemountOnParams><LoanOutWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/loans-out/:loanId/edit" element={<RemountOnParams><LoanOutWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/conservation" element={<ConservationPage />} />
        <Route path="/organizations/:orgId/collections/conservation/create" element={<RemountOnParams><ConservationWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/conservation/:treatmentId" element={<RemountOnParams><ConservationWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/conservation/:treatmentId/edit" element={<RemountOnParams><ConservationWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/exits" element={<ObjectExitsPage />} />
        <Route path="/organizations/:orgId/collections/exits/create" element={<RemountOnParams><ObjectExitWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/exits/:exitId" element={<RemountOnParams><ObjectExitWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/exits/:exitId/edit" element={<RemountOnParams><ObjectExitWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/deaccessions" element={<DeaccessionsPage />} />
        <Route path="/organizations/:orgId/collections/deaccessions/create" element={<RemountOnParams><DeaccessionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/deaccessions/:deaccessionId" element={<RemountOnParams><DeaccessionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/deaccessions/:deaccessionId/edit" element={<RemountOnParams><DeaccessionWorkspacePage /></RemountOnParams>} />
        {/* Legacy authority routes - redirect to constituents */}
        <Route path="/organizations/:orgId/collections/authorities" element={<Navigate to="../constituents" replace />} />
        <Route path="/organizations/:orgId/collections/contacts" element={<Navigate to="../constituents" replace />} />
        {/* Citations */}
        <Route path="/organizations/:orgId/collections/citations" element={<CitationsPage />} />
        <Route path="/organizations/:orgId/collections/citations/create" element={<RemountOnParams><CitationWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/citations/:citationId" element={<RemountOnParams><CitationWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/citations/:citationId/edit" element={<RemountOnParams><CitationWorkspacePage /></RemountOnParams>} />
        {/* CDWA Extended Authorities */}
        <Route path="/organizations/:orgId/collections/place-authorities/create" element={<RemountOnParams><PlaceAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/place-authorities/:placeAuthorityId" element={<RemountOnParams><PlaceAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/place-authorities/:placeAuthorityId/edit" element={<RemountOnParams><PlaceAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/style-period-authorities/create" element={<RemountOnParams><StylePeriodAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/style-period-authorities/:authorityId" element={<RemountOnParams><StylePeriodAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/style-period-authorities/:authorityId/edit" element={<RemountOnParams><StylePeriodAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/subject-authorities/create" element={<RemountOnParams><SubjectAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/subject-authorities/:authorityId" element={<RemountOnParams><SubjectAuthorityWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/subject-authorities/:authorityId/edit" element={<RemountOnParams><SubjectAuthorityWorkspacePage /></RemountOnParams>} />
        {/* Vocabulary Explorer */}
        <Route path="/organizations/:orgId/collections/vocabularies" element={<VocabularyExplorerPage />} />
        {/* Documentation Plans (list demoted from nav — detail pages kept) */}
        <Route path="/organizations/:orgId/collections/documentation-plans/create" element={<RemountOnParams><DocumentationPlanWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/documentation-plans/:planId" element={<RemountOnParams><DocumentationPlanWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/documentation-plans/:planId/edit" element={<RemountOnParams><DocumentationPlanWorkspacePage /></RemountOnParams>} />
        {/* Rights (list demoted from nav — detail pages kept; managed inline via ObjectRightsManager) */}
        <Route path="/organizations/:orgId/collections/rights" element={<CollectionRightsPage />} />
        <Route path="/organizations/:orgId/collections/rights/create" element={<RemountOnParams><RightWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/rights/:rightId" element={<RemountOnParams><RightWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/rights/:rightId/edit" element={<RemountOnParams><RightWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/objects/:objectId/rights/create" element={<RemountOnParams><RightWorkspacePage /></RemountOnParams>} />
        {/* Use Requests */}
        <Route path="/organizations/:orgId/collections/use-requests" element={<UseRequestsPage />} />
        <Route path="/organizations/:orgId/collections/use-requests/create" element={<RemountOnParams><UseRequestWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/use-requests/:requestId" element={<RemountOnParams><UseRequestWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/use-requests/:requestId/edit" element={<RemountOnParams><UseRequestWorkspacePage /></RemountOnParams>} />
        {/* Valuations */}
        <Route path="/organizations/:orgId/collections/valuations" element={<ValuationsPage />} />
        <Route path="/organizations/:orgId/collections/valuations/create" element={<RemountOnParams><ValuationWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/valuations/:valuationId" element={<RemountOnParams><ValuationWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/valuations/:valuationId/edit" element={<RemountOnParams><ValuationWorkspacePage /></RemountOnParams>} />

        {/* Insurance Management */}
        <Route path="/organizations/:orgId/collections/insurance" element={<InsurancePage />} />
        <Route path="/organizations/:orgId/collections/insurance/policies/create" element={<RemountOnParams><InsuranceWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/insurance/policies/:policyId" element={<RemountOnParams><InsuranceWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/insurance/policies/:policyId/edit" element={<RemountOnParams><InsuranceWorkspacePage /></RemountOnParams>} />
        {/* Indemnity Arrangements */}
        <Route path="/organizations/:orgId/collections/insurance/indemnities" element={<IndemnityArrangementsPage />} />
        <Route path="/organizations/:orgId/collections/insurance/indemnities/create" element={<RemountOnParams><IndemnityArrangementWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/insurance/indemnities/:indemnityId" element={<RemountOnParams><IndemnityArrangementWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/insurance/indemnities/:indemnityId/edit" element={<RemountOnParams><IndemnityArrangementWorkspacePage /></RemountOnParams>} />
        {/* Reproduction Requests */}
        <Route path="/organizations/:orgId/collections/reproduction-requests" element={<ReproductionRequestsPage />} />
        <Route path="/organizations/:orgId/collections/reproduction-requests/create" element={<RemountOnParams><ReproductionRequestWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/reproduction-requests/:requestId" element={<RemountOnParams><ReproductionRequestWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/reproduction-requests/:requestId/edit" element={<RemountOnParams><ReproductionRequestWorkspacePage /></RemountOnParams>} />
        {/* Incident Reports */}
        <Route path="/organizations/:orgId/collections/incidents" element={<IncidentReportsPage />} />
        <Route path="/organizations/:orgId/collections/incidents/create" element={<RemountOnParams><IncidentReportWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/incidents/:reportId" element={<RemountOnParams><IncidentReportWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/incidents/:reportId/edit" element={<RemountOnParams><IncidentReportWorkspacePage /></RemountOnParams>} />
        {/* Collections Reviews */}
        <Route path="/organizations/:orgId/collections/reviews" element={<CollectionsReviewsPage />} />
        <Route path="/organizations/:orgId/collections/reviews/create" element={<RemountOnParams><CollectionsReviewWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/reviews/:reviewId" element={<RemountOnParams><CollectionsReviewWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/reviews/:reviewId/edit" element={<RemountOnParams><CollectionsReviewWorkspacePage /></RemountOnParams>} />
        {/* Audit Campaigns */}
        <Route path="/organizations/:orgId/collections/audits" element={<AuditCampaignsPage />} />
        <Route path="/organizations/:orgId/collections/audits/create" element={<RemountOnParams><AuditCampaignWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/audits/:campaignId" element={<RemountOnParams><AuditCampaignWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/audits/:campaignId/edit" element={<RemountOnParams><AuditCampaignWorkspacePage /></RemountOnParams>} />
        {/* Emergency Plans */}
        <Route path="/organizations/:orgId/collections/emergency-plans" element={<EmergencyPlansPage />} />
        <Route path="/organizations/:orgId/collections/emergency-plans/create" element={<RemountOnParams><EmergencyPlanWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/emergency-plans/:planId" element={<RemountOnParams><EmergencyPlanWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/emergency-plans/:planId/edit" element={<RemountOnParams><EmergencyPlanWorkspacePage /></RemountOnParams>} />
        {/* Risk Overview */}
        <Route path="/organizations/:orgId/collections/risk-overview" element={<RiskOverviewPage />} />
        {/* Events */}
        <Route path="/organizations/:orgId/collections/events" element={<EventsPage />} />
        <Route path="/organizations/:orgId/collections/events/create" element={<RemountOnParams><EventWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/events/:eventId" element={<RemountOnParams><EventWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/events/:eventId/edit" element={<RemountOnParams><EventWorkspacePage /></RemountOnParams>} />
        {/* Exhibitions */}
        <Route path="/organizations/:orgId/collections/exhibitions" element={<ExhibitionsPage />} />
        <Route path="/organizations/:orgId/collections/exhibitions/create" element={<RemountOnParams><ExhibitionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/exhibitions/:exhibitionId" element={<RemountOnParams><ExhibitionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/exhibitions/:exhibitionId/edit" element={<RemountOnParams><ExhibitionWorkspacePage /></RemountOnParams>} />
        <Route path="/organizations/:orgId/collections/venues" element={<VenuesPage />} />
        <Route path="/organizations/:orgId/collections/exhibitions/settings" element={<ExhibitSettingsPage />} />
        <Route path="/organizations/:orgId/collections/exhibitions/settings/checklist-templates" element={<ChecklistTemplatesPage />} />
        <Route path="/organizations/:orgId/collections/exhibitions/settings/checklist-templates/:templateId" element={<ChecklistTemplateEditorPage />} />
        <Route path="/organizations/:orgId/collections/exhibitions/settings/label-templates" element={<LabelTemplatesPage />} />
        </Route>
        {/* Media (DAM) app routes */}
        <Route element={<AppAccessGuard name="Media" appKey="media" />}>
          {/* Media Work routes */}
          <Route path="/organizations/:orgId/media/work" element={<GlobalWorkPage />} />
          <Route path="/organizations/:orgId/media/work/workspaces" element={<WorkspacesListPage />} />
          <Route path="/organizations/:orgId/media/work/approvals" element={<ApprovalsPage />} />
          <Route path="/organizations/:orgId/media/work/workspaces/new" element={<WorkspaceCreatePage />} />
          <Route path="/organizations/:orgId/media/work/workspaces/:workspaceId/edit" element={<WorkspaceEditPage />} />
          <Route path="/organizations/:orgId/media/work/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
          <Route path="/organizations/:orgId/media" element={<MediaLibraryPage />} />
          <Route path="/organizations/:orgId/media/analytics" element={<MediaAnalyticsPage />} />
          <Route path="/organizations/:orgId/media/watermark-templates" element={<WatermarkTemplatesPage />} />
          <Route path="/organizations/:orgId/media/metadata-templates" element={<MetadataTemplatesPage />} />
          <Route path="/organizations/:orgId/media/processing-jobs" element={<ProcessingJobsPage />} />
          <Route path="/organizations/:orgId/media/publishing" element={<MediaPublishingPage />} />
          <Route path="/organizations/:orgId/media/tag-settings" element={<MediaTagSettingsPage />} />
          {/* Media Reports */}
          {/* Media configuration - single page settings */}
          <Route path="/organizations/:orgId/media/config" element={<MediaConfigPage />} />
          <Route path="/organizations/:orgId/media/ai-config" element={<MediaAIConfigPage />} />
          <Route path="/organizations/:orgId/media/field-inheritance" element={<MediaFieldInheritanceSettingsPage />} />
          <Route path="/organizations/:orgId/media/derivative-settings" element={<MediaDerivativeSettingsPage />} />
          <Route path="/organizations/:orgId/media/rights-enforcement" element={<MediaRightsEnforcementSettingsPage />} />
          <Route path="/organizations/:orgId/media/review-queue" element={<MetadataReviewPage />} />
          {/* Media Download Requests */}
          <Route path="/organizations/:orgId/media/download-requests" element={<DownloadRequestsPage />} />
          <Route path="/organizations/:orgId/media/download-requests/:requestId" element={<RemountOnParams><DownloadRequestWorkspacePage /></RemountOnParams>} />
          <Route path="/organizations/:orgId/media/my-download-requests" element={<MyDownloadRequestsPage />} />
          {/* Media Collections (Lightboxes) */}
          <Route path="/organizations/:orgId/media/collections" element={<MediaCollectionsPage />} />
          <Route path="/organizations/:orgId/media/collections/:collectionId" element={<MediaCollectionDetailPage />} />
          <Route path="/organizations/:orgId/media/my-shares" element={<MyLightboxSharesPage />} />
          {/* Preservation dashboard */}
          <Route path="/organizations/:orgId/media/preservation" element={<MediaPreservationDashboardPage />} />
          <Route path="/organizations/:orgId/media/:mediaId" element={<RemountOnParams><MediaDetailPage /></RemountOnParams>}>
            <Route path="annotations" element={<MediaAnnotationsPage />} />
            <Route path="transform" element={<MediaTransformPage />} />
            <Route path="rights" element={<MediaRightsPage />} />
            <Route path="preservation" element={<MediaPreservationPage />} />
            <Route path="ai" element={<MediaAIPage />} />
            <Route path="history" element={<MediaHistoryPage />} />
          </Route>
        </Route>
        {/* Legacy media route - redirect to new location */}
        <Route path="/organizations/:orgId/collections/media" element={<MediaLibraryPage />} />
        {/* Legacy exhibit routes — redirect to collections */}
        <Route path="/organizations/:orgId/exhibit/*" element={<Navigate to="../collections/exhibitions" replace />} />
        {/* Content CMS routes */}
        <Route element={<AppAccessGuard name="Content" appKey="content" />}>
          <Route path="/organizations/:orgId/content/pages" element={<PagesListPage />} />
          <Route path="/organizations/:orgId/content/pages/create" element={<PageEditorPage />} />
          <Route path="/organizations/:orgId/content/pages/:pageId" element={<PageEditorPage />} />
          <Route path="/organizations/:orgId/content/posts" element={<PostsListPage />} />
          <Route path="/organizations/:orgId/content/posts/create" element={<PageEditorPage />} />
          <Route path="/organizations/:orgId/content/posts/:pageId" element={<PageEditorPage />} />
          <Route path="/organizations/:orgId/content/categories" element={<CategoriesPage />} />
          <Route path="/organizations/:orgId/content/site-settings" element={<ContentSiteSettingsPage />} />
        </Route>
        {/* Guide routes */}
        <Route element={<AppAccessGuard name="Guide" appKey="guide" />}>
          <Route path="/organizations/:orgId/guide/documents" element={<GuideDocumentsPage />} />
          <Route path="/organizations/:orgId/guide/widget" element={<GuideWidgetPage />} />
          <Route path="/organizations/:orgId/guide/qr" element={<GuideQrKitPage />} />
          <Route path="/organizations/:orgId/guide/visitors" element={<GuideVisitorInsightsPage />} />
          <Route path="/organizations/:orgId/guide/chat" element={<GuideChatPage />} />
          {/* Orchestration queues live in each product's Work area, product-filtered. */}
          <Route path="/organizations/:orgId/collections/work/plans" element={<AgentPlansPage />} />
          <Route path="/organizations/:orgId/collections/work/plans/:planId" element={<PlanDetailPage />} />
          <Route path="/organizations/:orgId/collections/work/drafts" element={<DraftsInboxPage />} />
          <Route path="/organizations/:orgId/media/work/plans" element={<AgentPlansPage />} />
          <Route path="/organizations/:orgId/media/work/plans/:planId" element={<PlanDetailPage />} />
          <Route path="/organizations/:orgId/media/work/drafts" element={<DraftsInboxPage />} />
          {/* Legacy /guide/* deep-links → product Work (keeps old links alive). */}
          <Route path="/organizations/:orgId/guide/plans" element={<RedirectGuidePlans />} />
          <Route path="/organizations/:orgId/guide/plans/:planId" element={<RedirectGuidePlans />} />
          <Route path="/organizations/:orgId/guide/drafts" element={<RedirectGuideDrafts />} />
        </Route>
        {/* Legacy non-org routes for backward compatibility */}
        <Route path="/settings" element={<UserSettingsPage />} />
        {/* Default org route - redirect to flow */}
        <Route path="/organizations/:orgId" element={<OrgDefaultRedirect />} />
        {/* 404 catch-all */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
