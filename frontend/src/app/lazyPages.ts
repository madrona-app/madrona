import React from 'react';

// All route-level pages are lazy-loaded and imported from their concrete
// file paths — NOT through pages/<area>/index.ts barrels. The barrels
// re-export every page in an area concretely, so importing through them
// defeats code-splitting and pulls entire areas into a single chunk.
//
// If you add a new route page, add it here with a direct file import.

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const AccountSecurityPage = React.lazy(() => import('../pages/auth/AccountSecurityPage'));
export const ActivateAccountPage = React.lazy(() => import('../pages/auth/ActivateAccountPage'));
export const InstallPage = React.lazy(() => import('../pages/auth/InstallPage'));
export const ForgotPasswordPage = React.lazy(() => import('../pages/auth/ForgotPasswordPage'));
export const ResetPasswordPage = React.lazy(() => import('../pages/auth/ResetPasswordPage'));
export const RecoverMfaPage = React.lazy(() => import('../pages/auth/RecoverMfaPage'));
export const SignInPage = React.lazy(() => import('../pages/auth/SignInPage'));

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------
export const BridgeOverview = React.lazy(() => import('../pages/bridge/BridgeOverview'));
export const ConnectorsPage = React.lazy(() => import('../pages/bridge/ConnectorsPage'));
export const DatasetDetailPage = React.lazy(() => import('../pages/bridge/DatasetDetailPage'));
export const DatasetsPage = React.lazy(() => import('../pages/bridge/DatasetsPage'));
export const PipelineDetailPage = React.lazy(() => import('../pages/bridge/PipelineDetailPage'));
export const PipelinesPage = React.lazy(() => import('../pages/bridge/PipelinesPage'));
export const ProjectionConfigPage = React.lazy(() => import('../pages/bridge/ProjectionConfigPage'));
export const RunDetailPage = React.lazy(() => import('../pages/bridge/RunDetailPage'));
export const RunsListPage = React.lazy(() => import('../pages/bridge/RunsListPage'));
export const SettingsPage = React.lazy(() => import('../pages/bridge/SettingsPage'));
export const SetupDatasetsPage = React.lazy(() => import('../pages/bridge/SetupDatasetsPage'));
export const SetupPage = React.lazy(() => import('../pages/bridge/SetupPage'));
export const SetupRunsPage = React.lazy(() => import('../pages/bridge/SetupRunsPage'));
export const SetupWizardPage = React.lazy(() => import('../pages/bridge/SetupWizardPage'));

// ---------------------------------------------------------------------------
// Collections — list & settings pages
// ---------------------------------------------------------------------------
export const AcquisitionsPage = React.lazy(() => import('../pages/collections/AcquisitionsPage'));
export const AuditCampaignsPage = React.lazy(() => import('../pages/collections/AuditCampaignsPage'));
export const BarcodeLabelsPage = React.lazy(() => import('../pages/collections/BarcodeLabelsPage'));
export const BarcodeScannerPage = React.lazy(() => import('../pages/collections/BarcodeScannerPage'));
export const BarcodeScansPage = React.lazy(() => import('../pages/collections/BarcodeScansPage'));
export const BrandingSettingsPage = React.lazy(() => import('../pages/collections/BrandingSettingsPage'));
export const CollectionScopeSettingsPage = React.lazy(() => import('../pages/collections/CollectionScopeSettingsPage'));
export const CitationsPage = React.lazy(() => import('../pages/collections/CitationsPage'));
export const CollectionLocationsPage = React.lazy(() => import('../pages/collections/CollectionLocationsPage'));
export const CollectionMovementsPage = React.lazy(() => import('../pages/collections/CollectionMovementsPage'));
export const CollectionObjectsPage = React.lazy(() => import('../pages/collections/CollectionObjectsPage'));
export const CollectionsConfigPage = React.lazy(() => import('../pages/collections/CollectionsConfigPage'));
export const CollectionsGeneralSettingsPage = React.lazy(() => import('../pages/collections/CollectionsGeneralSettingsPage'));
export const CollectionsReviewsPage = React.lazy(() => import('../pages/collections/CollectionsReviewsPage'));
export const ConditionReportsPage = React.lazy(() => import('../pages/collections/ConditionReportsPage'));
export const ConservationPage = React.lazy(() => import('../pages/collections/ConservationPage'));
export const ConstituentsPage = React.lazy(() => import('../pages/collections/ConstituentsPage'));
export const CratesPage = React.lazy(() => import('../pages/collections/CratesPage'));
export const DeaccessionsPage = React.lazy(() => import('../pages/collections/DeaccessionsPage'));
export const DiscoverSettingsPage = React.lazy(() => import('../pages/collections/DiscoverSettingsPage'));
export const ProcedureEnforcementSettingsPage = React.lazy(() => import('../pages/collections/ProcedureEnforcementSettingsPage'));
export const MediaRightsEnforcementSettingsPage = React.lazy(() => import('../pages/media/MediaRightsEnforcementSettingsPage'));
export const DocumentationPlansPage = React.lazy(() => import('../pages/collections/DocumentationPlansPage'));
export const EmergencyPlansPage = React.lazy(() => import('../pages/collections/EmergencyPlansPage'));
export const EventsPage = React.lazy(() => import('../pages/collections/EventsPage'));
export const ExhibitionsPage = React.lazy(() => import('../pages/collections/ExhibitionsPage'));
export const IncidentReportsPage = React.lazy(() => import('../pages/collections/IncidentReportsPage'));
export const IndemnityArrangementsPage = React.lazy(() => import('../pages/collections/IndemnityArrangementsPage'));
export const InsurancePage = React.lazy(() => import('../pages/collections/InsurancePage'));
export const LoansInPage = React.lazy(() => import('../pages/collections/LoansInPage'));
export const LoansOutPage = React.lazy(() => import('../pages/collections/LoansOutPage'));
export const LookupValuesPage = React.lazy(() => import('../pages/collections/LookupValuesPage'));
export const ObjectEntriesPage = React.lazy(() => import('../pages/collections/ObjectEntriesPage'));
export const ObjectExitsPage = React.lazy(() => import('../pages/collections/ObjectExitsPage'));
export const ReportTemplatesSettingsPage = React.lazy(() => import('../pages/collections/ReportTemplatesSettingsPage'));
export const ReproductionRequestsPage = React.lazy(() => import('../pages/collections/ReproductionRequestsPage'));
export const RightsPage = React.lazy(() => import('../pages/collections/RightsPage'));
export const RiskOverviewPage = React.lazy(() => import('../pages/collections/RiskOverviewPage'));
export const ShipmentsPage = React.lazy(() => import('../pages/collections/ShipmentsPage'));
export const UseRequestsPage = React.lazy(() => import('../pages/collections/UseRequestsPage'));
export const ValuationsPage = React.lazy(() => import('../pages/collections/ValuationsPage'));
export const VocabularyExplorerPage = React.lazy(() => import('../pages/collections/VocabularyExplorerPage'));

// ---------------------------------------------------------------------------
// Collections — workspace (detail) pages
// ---------------------------------------------------------------------------
export const AcquisitionWorkspacePage = React.lazy(() => import('../pages/collections/AcquisitionWorkspacePage'));
export const AuditCampaignWorkspacePage = React.lazy(() => import('../pages/collections/AuditCampaignWorkspacePage'));
export const BarcodeLabelWorkspacePage = React.lazy(() => import('../pages/collections/BarcodeLabelWorkspacePage'));
export const CitationWorkspacePage = React.lazy(() => import('../pages/collections/CitationWorkspacePage'));
export const CollectionObjectWorkspacePage = React.lazy(() => import('../pages/collections/CollectionObjectWorkspacePage'));
export const CollectionsReviewWorkspacePage = React.lazy(() => import('../pages/collections/CollectionsReviewWorkspacePage'));
export const ConditionReportWorkspacePage = React.lazy(() => import('../pages/collections/ConditionReportWorkspacePage'));
export const ConservationWorkspacePage = React.lazy(() => import('../pages/collections/ConservationWorkspacePage'));
export const ConstituentWorkspacePage = React.lazy(() => import('../pages/collections/ConstituentWorkspacePage'));
export const CrateWorkspacePage = React.lazy(() => import('../pages/collections/CrateWorkspacePage'));
export const DeaccessionWorkspacePage = React.lazy(() => import('../pages/collections/DeaccessionWorkspacePage'));
export const DocumentationPlanWorkspacePage = React.lazy(() => import('../pages/collections/DocumentationPlanWorkspacePage'));
export const EmergencyPlanWorkspacePage = React.lazy(() => import('../pages/collections/EmergencyPlanWorkspacePage'));
export const EventWorkspacePage = React.lazy(() => import('../pages/collections/EventWorkspacePage'));
export const ExhibitionWorkspacePage = React.lazy(() => import('../pages/collections/ExhibitionWorkspacePage'));
export const IncidentReportWorkspacePage = React.lazy(() => import('../pages/collections/IncidentReportWorkspacePage'));
export const IndemnityArrangementWorkspacePage = React.lazy(() => import('../pages/collections/IndemnityArrangementWorkspacePage'));
export const InsuranceWorkspacePage = React.lazy(() => import('../pages/collections/InsuranceWorkspacePage'));
export const LoanInWorkspacePage = React.lazy(() => import('../pages/collections/LoanInWorkspacePage'));
export const LoanOutWorkspacePage = React.lazy(() => import('../pages/collections/LoanOutWorkspacePage'));
export const MovementWorkspacePage = React.lazy(() => import('../pages/collections/MovementWorkspacePage'));
export const ObjectEntryWorkspacePage = React.lazy(() => import('../pages/collections/ObjectEntryWorkspacePage'));
export const ObjectExitWorkspacePage = React.lazy(() => import('../pages/collections/ObjectExitWorkspacePage'));
export const PlaceAuthorityWorkspacePage = React.lazy(() => import('../pages/collections/PlaceAuthorityWorkspacePage'));
export const ReproductionRequestWorkspacePage = React.lazy(() => import('../pages/collections/ReproductionRequestWorkspacePage'));
export const RightWorkspacePage = React.lazy(() => import('../pages/collections/RightWorkspacePage'));
export const ShipmentWorkspacePage = React.lazy(() => import('../pages/collections/ShipmentWorkspacePage'));
export const StylePeriodAuthorityWorkspacePage = React.lazy(() => import('../pages/collections/StylePeriodAuthorityWorkspacePage'));
export const SubjectAuthorityWorkspacePage = React.lazy(() => import('../pages/collections/SubjectAuthorityWorkspacePage'));
export const UseRequestWorkspacePage = React.lazy(() => import('../pages/collections/UseRequestWorkspacePage'));
export const ValuationWorkspacePage = React.lazy(() => import('../pages/collections/ValuationWorkspacePage'));

// ---------------------------------------------------------------------------
// Media (DAM)
// ---------------------------------------------------------------------------
export const DownloadRequestsPage = React.lazy(() => import('../pages/media/DownloadRequestsPage'));
export const DownloadRequestWorkspacePage = React.lazy(() => import('../pages/media/DownloadRequestWorkspacePage'));
export const MediaAIConfigPage = React.lazy(() => import('../pages/media/MediaAIConfigPage'));
export const MediaAnalyticsPage = React.lazy(() => import('../pages/media/MediaAnalyticsPage'));
export const MediaCollectionDetailPage = React.lazy(() => import('../pages/media/MediaCollectionDetailPage'));
export const MediaCollectionsPage = React.lazy(() => import('../pages/media/MediaCollectionsPage'));
export const MyLightboxSharesPage = React.lazy(() => import('../pages/media/MyLightboxSharesPage'));
export const MediaConfigPage = React.lazy(() => import('../pages/media/MediaConfigPage'));
export const MediaDerivativeSettingsPage = React.lazy(() => import('../pages/media/MediaDerivativeSettingsPage'));
export const MediaDetailPage = React.lazy(() => import('../pages/media/MediaDetailPage'));
export const MediaAnnotationsPage = React.lazy(() => import('../pages/media/MediaDetailPage/AnnotationsPage'));
export const MediaTransformPage = React.lazy(() => import('../pages/media/MediaDetailPage/TransformPage'));
export const MediaRightsPage = React.lazy(() => import('../pages/media/MediaDetailPage/RightsPage'));
export const MediaPreservationPage = React.lazy(() => import('../pages/media/MediaDetailPage/PreservationPage'));
export const MediaAIPage = React.lazy(() => import('../pages/media/MediaDetailPage/AIPage'));
export const MediaHistoryPage = React.lazy(() => import('../pages/media/MediaDetailPage/HistoryPage'));
export const MediaFieldInheritanceSettingsPage = React.lazy(() => import('../pages/media/MediaFieldInheritanceSettingsPage'));
export const MediaLibraryPage = React.lazy(() => import('../pages/media/MediaLibraryPage'));
export const MediaPreservationDashboardPage = React.lazy(() => import('../pages/media/MediaPreservationDashboardPage'));
export const MediaPublishingPage = React.lazy(() => import('../pages/media/MediaPublishingPage'));
export const MediaTagSettingsPage = React.lazy(() => import('../pages/media/MediaTagSettingsPage'));
export const MetadataReviewPage = React.lazy(() => import('../pages/media/MetadataReviewPage'));
export const MetadataTemplatesPage = React.lazy(() => import('../pages/media/MetadataTemplatesPage'));
export const MyDownloadRequestsPage = React.lazy(() => import('../pages/media/MyDownloadRequestsPage'));
export const ProcessingJobsPage = React.lazy(() => import('../pages/media/ProcessingJobsPage'));
export const WatermarkTemplatesPage = React.lazy(() => import('../pages/media/WatermarkTemplatesPage'));

// ---------------------------------------------------------------------------
// Exhibit
// ---------------------------------------------------------------------------
export const ChecklistTemplateEditorPage = React.lazy(() => import('../pages/exhibit/ChecklistTemplateEditorPage'));
export const ChecklistTemplatesPage = React.lazy(() => import('../pages/exhibit/ChecklistTemplatesPage'));
export const ExhibitSettingsPage = React.lazy(() => import('../pages/exhibit/ExhibitSettingsPage'));
export const LabelTemplatesPage = React.lazy(() => import('../pages/exhibit/LabelTemplatesPage'));
export const VenuesPage = React.lazy(() => import('../pages/exhibit/VenuesPage'));

// ---------------------------------------------------------------------------
// Discover (public collection site)
// ---------------------------------------------------------------------------
export const BlogListPage = React.lazy(() => import('../pages/discover/BlogListPage'));
export const BlogPostPage = React.lazy(() => import('../pages/discover/BlogPostPage'));
export const ContentPage = React.lazy(() => import('../pages/discover/ContentPage'));
export const DiscoverObjectPage = React.lazy(() => import('../pages/discover/DiscoverObjectPage').then(m => ({ default: m.DiscoverObjectPage })));
export const GuideStandalonePage = React.lazy(() => import('../pages/discover/GuideStandalonePage'));
export const DiscoverPage = React.lazy(() => import('../pages/discover/DiscoverPage').then(m => ({ default: m.DiscoverPage })));
export const EventDetailPublicPage = React.lazy(() => import('../pages/discover/EventDetailPage'));
export const EventListPublicPage = React.lazy(() => import('../pages/discover/EventListPage'));
export const ExhibitionDetailPublicPage = React.lazy(() => import('../pages/discover/ExhibitionDetailPage'));
export const ExhibitionListPublicPage = React.lazy(() => import('../pages/discover/ExhibitionListPage'));
export const NotFoundPublicPage = React.lazy(() => import('../pages/discover/NotFoundPublicPage'));
export const PublicCollectionPage = React.lazy(() => import('../pages/discover/PublicCollectionPage'));
export const VenueDetailPage = React.lazy(() => import('../pages/discover/VenueDetailPage'));
export const VenueListPage = React.lazy(() => import('../pages/discover/VenueListPage'));

// ---------------------------------------------------------------------------
// Content CMS
// ---------------------------------------------------------------------------
export const CategoriesPage = React.lazy(() => import('../pages/content/CategoriesPage'));
export const ContentSiteSettingsPage = React.lazy(() => import('../pages/content/ContentSiteSettingsPage'));
export const PageEditorPage = React.lazy(() => import('../pages/content/PageEditorPage'));
export const PagesListPage = React.lazy(() => import('../pages/content/PagesListPage'));
export const PostsListPage = React.lazy(() => import('../pages/content/PostsListPage'));

// ---------------------------------------------------------------------------
// Guide
// ---------------------------------------------------------------------------
export const GuideChatPage = React.lazy(() => import('../pages/guide/GuideChatPage'));
export const GuideDocumentsPage = React.lazy(() => import('../pages/guide/GuideDocumentsPage'));
export const GuideWidgetPage = React.lazy(() => import('../pages/guide/GuideWidgetPage'));
export const GuideQrKitPage = React.lazy(() => import('../pages/guide/GuideQrKitPage'));
export const GuideVisitorInsightsPage = React.lazy(() => import('../pages/guide/GuideVisitorInsightsPage'));

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
export const HomePage = React.lazy(() => import('../pages/home/HomePage'));
export const RecentActivityPage = React.lazy(() => import('../pages/home/v2/RecentActivityPage'));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export const ReportsPage = React.lazy(() => import('../pages/reports/ReportsPage'));

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const APIKeysPage = React.lazy(() => import('../pages/admin/APIKeysPage'));
export const AppSubscriptionsPage = React.lazy(() => import('../pages/admin/AppSubscriptionsPage'));
export const BulkUserImportPage = React.lazy(() => import('../pages/admin/BulkUserImportPage'));
export const DepartmentManagementPage = React.lazy(() => import('../pages/admin/DepartmentManagementPage'));
export const EntityAuditPage = React.lazy(() => import('../pages/admin/EntityAuditPage'));
export const LogsPage = React.lazy(() => import('../pages/admin/LogsPage'));
export const OrganizationsPage = React.lazy(() => import('../pages/admin/OrganizationsPage'));
export const OrganizationUsersPage = React.lazy(() => import('../pages/admin/OrganizationUsersPage'));
export const ProvisioningJobDetailPage = React.lazy(() => import('../pages/admin/ProvisioningJobDetailPage'));
export const PermissionManagementPage = React.lazy(() => import('../pages/admin/PermissionManagementPage'));
export const RelationshipDefinitionsPage = React.lazy(() => import('../pages/admin/RelationshipDefinitionsPage'));
export const RoleManagementPage = React.lazy(() => import('../pages/admin/RoleManagementPage'));
export const OrganizationApplicationsPage = React.lazy(() => import('../pages/admin/OrganizationApplicationsPage'));
export const SSOConfigurationPage = React.lazy(() => import('../pages/admin/SSOConfigurationPage'));
export const StorageConfigPage = React.lazy(() => import('../pages/admin/StorageConfigPage'));
export const UserSettingsPage = React.lazy(() => import('../pages/admin/UserSettingsPage').then(m => ({ default: m.UserSettingsPage })));

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------
export const ApprovalsPage = React.lazy(() => import('../pages/work/ApprovalsPage'));
export const AgentPlansPage = React.lazy(() => import('../pages/work/AgentPlansPage'));
export const PlanDetailPage = React.lazy(() => import('../pages/work/PlanDetailPage'));
export const DraftsInboxPage = React.lazy(() => import('../pages/work/DraftsInboxPage'));
export const GlobalWorkPage = React.lazy(() => import('../pages/work/GlobalWorkPage'));
export const WorkspaceCreatePage = React.lazy(() => import('../pages/work/WorkspaceCreatePage'));
export const WorkspaceDetailPage = React.lazy(() => import('../pages/work/WorkspaceDetailPage'));
export const WorkspaceEditPage = React.lazy(() => import('../pages/work/WorkspaceEditPage'));
export const WorkspacesListPage = React.lazy(() => import('../pages/work/WorkspacesListPage'));

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
export const EntityDetailPage = React.lazy(() => import('../pages/shared/EntityDetailPage'));
export const EntitySearchPage = React.lazy(() => import('../pages/shared/EntitySearchPage'));
export const NotificationsPage = React.lazy(() => import('../pages/shared/NotificationsPage'));
