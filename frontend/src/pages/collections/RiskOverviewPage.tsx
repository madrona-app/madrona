import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Shield,
  AlertCircle,
  AlertTriangle,
  ClipboardCheck,
  Hammer,
  FileText,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import {
  getConditionReports,
  getIncidentReports,
  getConservationTreatments,
  getEmergencyPlans,
} from '../../lib/api';
import { formatDateShort } from '@/lib/formatters';

const CONDITION_STYLES: Record<string, string> = {
  excellent: 'bg-semantic-success/10 text-semantic-success',
  good: 'bg-semantic-info/10 text-semantic-info',
  fair: 'bg-semantic-warning/10 text-semantic-warning',
  poor: 'bg-copper/10 text-copper',
  unacceptable: 'bg-semantic-error/10 text-semantic-error',
};

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  theft: 'Theft',
  damage: 'Damage',
  loss: 'Loss',
  fire: 'Fire',
  flood: 'Flood',
  vandalism: 'Vandalism',
  other: 'Other',
};

export default function RiskOverviewPage() {
  const { orgId } = useParams<{ orgId: string }>();

  // Fetch data from multiple sources in parallel
  const { data: conditionData, isLoading: loadingCondition } = useQuery({
    queryKey: ['risk-overview-condition', orgId],
    queryFn: () => getConditionReports(orgId!, { limit: 100 }),
    enabled: !!orgId,
  });

  const { data: incidentData, isLoading: loadingIncidents } = useQuery({
    queryKey: ['risk-overview-incidents', orgId],
    queryFn: () => getIncidentReports(orgId!, { limit: 50 }),
    enabled: !!orgId,
  });

  const { data: conservationData, isLoading: loadingConservation } = useQuery({
    queryKey: ['risk-overview-conservation', orgId],
    queryFn: () => getConservationTreatments(orgId!, { status: 'in_progress', limit: 50 }),
    enabled: !!orgId,
  });

  const { data: emergencyData, isLoading: loadingEmergency } = useQuery({
    queryKey: ['risk-overview-emergency', orgId],
    queryFn: () => getEmergencyPlans(orgId!, { status: 'active', limit: 20 }),
    enabled: !!orgId,
  });

  const isLoading = loadingCondition || loadingIncidents || loadingConservation || loadingEmergency;

  // Extract and categorize data
  const conditionReports = conditionData?.items || [];
  const incidents = incidentData?.items || [];
  const conservationTreatments = conservationData?.items || [];
  const emergencyPlans = emergencyData?.items || [];

  // Calculate risk metrics
  const poorConditionReports = conditionReports.filter(
    (r) => r.overall_condition === 'poor' || r.overall_condition === 'unacceptable'
  );
  const openIncidents = incidents.filter(
    (i) => i.status && i.status !== 'closed' && i.status !== 'resolved'
  );
  const activeConservation = conservationTreatments.filter((t) => t.status === 'in_progress');
  const activeEmergencyPlans = emergencyPlans.filter((p) => p.status === 'active');

  // Get recent incidents (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentIncidents = incidents.filter(
    (i) => i.incident_date && new Date(i.incident_date) >= thirtyDaysAgo
  );

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-parchment border border-lichen rounded-lg p-4 h-24" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-parchment border border-lichen rounded-lg p-4 h-48" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-bark/10 rounded-lg">
            <Shield size={28} className="text-bark" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Risk Overview</h1>
            <p className="text-sm text-archive mt-1">
              Aggregate view of collection risks, incidents, and active care activities.
              Supports Risk Management procedures.
            </p>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-error/10 rounded-lg flex items-center justify-center">
              <AlertCircle size={20} className="text-semantic-error" />
            </div>
            <div>
              <p className="text-xl font-semibold text-ink">{openIncidents.length}</p>
              <p className="text-sm text-archive">Open Incidents</p>
            </div>
          </div>
        </div>

        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-copper/10 rounded-lg flex items-center justify-center">
              <ClipboardCheck size={20} className="text-copper" />
            </div>
            <div>
              <p className="text-xl font-semibold text-ink">{poorConditionReports.length}</p>
              <p className="text-sm text-archive">At-Risk Conditions</p>
            </div>
          </div>
        </div>

        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <Hammer size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-xl font-semibold text-ink">{activeConservation.length}</p>
              <p className="text-sm text-archive">Active Treatments</p>
            </div>
          </div>
        </div>

        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <AlertTriangle size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-xl font-semibold text-ink">{activeEmergencyPlans.length}</p>
              <p className="text-sm text-archive">Emergency Plans</p>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Incidents */}
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="text-semantic-error" />
              <h2 className="text-base font-semibold text-forest">Recent Incidents</h2>
              <span className="text-xs text-archive">(Last 30 days)</span>
            </div>
            <Link
              to={`/organizations/${orgId}/collections/incidents`}
              className="text-sm text-bark hover:text-copper-dark no-underline"
            >
              View all
            </Link>
          </div>
          {recentIncidents.length > 0 ? (
            <ul className="divide-y divide-lichen">
              {recentIncidents.slice(0, 5).map((incident) => (
                <li key={incident.report_id} className="px-4 py-3 hover:bg-stone/30 transition-colors">
                  <Link
                    to={`/organizations/${orgId}/collections/incidents/${incident.report_id}`}
                    className="block no-underline"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-bark">{incident.report_number}</span>
                      <span className="text-xs text-archive">
                        {incident.incident_date
                          ? formatDateShort(incident.incident_date)
                          : 'No date'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-ink">
                        {incident.incident_type
                          ? INCIDENT_TYPE_LABELS[incident.incident_type] || incident.incident_type
                          : 'Incident'}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          incident.status === 'submitted'
                            ? 'bg-semantic-error/10 text-semantic-error'
                            : incident.status === 'under_investigation'
                            ? 'bg-semantic-warning/10 text-semantic-warning'
                            : incident.status === 'draft'
                            ? 'bg-stone text-archive'
                            : 'bg-semantic-info/10 text-semantic-info'
                        }`}
                      >
                        {incident.status?.replace('_', ' ') || 'Unknown'}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center">
              <TrendingUp size={24} className="mx-auto text-semantic-success mb-2" />
              <p className="text-sm text-archive">No incidents in the last 30 days</p>
            </div>
          )}
        </div>

        {/* At-Risk Conditions */}
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={18} className="text-copper" />
              <h2 className="text-base font-semibold text-forest">At-Risk Conditions</h2>
            </div>
            <Link
              to={`/organizations/${orgId}/collections/condition-reports`}
              className="text-sm text-bark hover:text-copper-dark no-underline"
            >
              View all
            </Link>
          </div>
          {poorConditionReports.length > 0 ? (
            <ul className="divide-y divide-lichen">
              {poorConditionReports.slice(0, 5).map((report) => (
                <li key={report.report_id} className="px-4 py-3 hover:bg-stone/30 transition-colors">
                  <Link
                    to={`/organizations/${orgId}/collections/condition-reports/${report.report_id}`}
                    className="block no-underline"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-bark">{report.report_number}</span>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          CONDITION_STYLES[report.overall_condition || ''] || 'bg-stone text-ink'
                        }`}
                      >
                        {report.overall_condition
                          ? report.overall_condition.charAt(0).toUpperCase() +
                            report.overall_condition.slice(1)
                          : 'Unknown'}
                      </span>
                    </div>
                    <p className="text-sm text-archive mt-1 truncate">
                      {report.condition_summary || 'No summary'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center">
              <TrendingUp size={24} className="mx-auto text-semantic-success mb-2" />
              <p className="text-sm text-archive">No objects with poor or unacceptable conditions</p>
            </div>
          )}
        </div>

        {/* Active Conservation */}
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hammer size={18} className="text-semantic-info" />
              <h2 className="text-base font-semibold text-forest">Active Conservation</h2>
            </div>
            <Link
              to={`/organizations/${orgId}/collections/conservation`}
              className="text-sm text-bark hover:text-copper-dark no-underline"
            >
              View all
            </Link>
          </div>
          {activeConservation.length > 0 ? (
            <ul className="divide-y divide-lichen">
              {activeConservation.slice(0, 5).map((treatment) => (
                <li key={treatment.treatment_id} className="px-4 py-3 hover:bg-stone/30 transition-colors">
                  <Link
                    to={`/organizations/${orgId}/collections/conservation/${treatment.treatment_id}`}
                    className="block no-underline"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-bark">{treatment.treatment_number}</span>
                      <span className="text-xs text-archive">
                        {treatment.treatment_type
                          ? treatment.treatment_type.charAt(0).toUpperCase() +
                            treatment.treatment_type.slice(1).replace('_', ' ')
                          : 'Treatment'}
                      </span>
                    </div>
                    <p className="text-sm text-archive mt-1 truncate">
                      {treatment.proposal_summary || 'No description'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center">
              <FileText size={24} className="mx-auto text-archive mb-2" />
              <p className="text-sm text-archive">No conservation treatments in progress</p>
            </div>
          )}
        </div>

        {/* Emergency Plans */}
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-semantic-warning" />
              <h2 className="text-base font-semibold text-forest">Emergency Plans</h2>
            </div>
            <Link
              to={`/organizations/${orgId}/collections/emergency-plans`}
              className="text-sm text-bark hover:text-copper-dark no-underline"
            >
              View all
            </Link>
          </div>
          {activeEmergencyPlans.length > 0 ? (
            <ul className="divide-y divide-lichen">
              {activeEmergencyPlans.slice(0, 5).map((plan) => (
                <li key={plan.plan_id} className="px-4 py-3 hover:bg-stone/30 transition-colors">
                  <Link
                    to={`/organizations/${orgId}/collections/emergency-plans/${plan.plan_id}`}
                    className="block no-underline"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-bark">{plan.plan_number}</span>
                      <div className="flex items-center gap-1 text-xs text-archive">
                        <Calendar size={12} />
                        {plan.next_review_date
                          ? formatDateShort(plan.next_review_date)
                          : 'No review date'}
                      </div>
                    </div>
                    <p className="text-sm text-ink mt-1 truncate">{plan.title || 'Untitled plan'}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center">
              <FileText size={24} className="mx-auto text-archive mb-2" />
              <p className="text-sm text-archive">No active emergency plans</p>
            </div>
          )}
        </div>
      </div>

      {/* Help Text */}
      <div className="bg-bark/5 border border-bark/20 rounded-lg p-4">
        <p className="text-sm text-bark">
          <strong>Risk Management</strong> involves identifying, assessing,
          and mitigating risks to collections. This dashboard provides an at-a-glance view of current
          risk indicators to help prioritize preventive conservation and emergency response activities.
        </p>
      </div>
    </div>
  );
}
