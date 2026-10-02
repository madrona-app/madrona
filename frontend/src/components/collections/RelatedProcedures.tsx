import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  FileBox,
  ArrowUpRight,
  Wrench,
  ClipboardCheck,
  Trash2,
  AlertCircle,
  Loader2,
  FileQuestion,
} from 'lucide-react';
import { getObjectProcedures } from '../../lib/api';
import { formatDateShort } from '../../lib/formatters';
import type {
  AcquisitionSummary,
  LoanOutSummary,
  ConservationSummary,
  ConditionReportSummary,
  DeaccessionSummary,
  UseRequestSummary,
  IncidentReportSummary,
} from '../../lib/schemas';

interface RelatedProceduresProps {
  organizationId: string;
  objectId: string;
}

interface ProcedureSectionProps<T> {
  title: string;
  icon: React.ReactNode;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  emptyMessage?: string;
  defaultExpanded?: boolean;
}

function ProcedureSection<T>({
  title,
  icon,
  items,
  renderItem,
  emptyMessage = 'None',
  defaultExpanded = false,
}: ProcedureSectionProps<T>) {
  const [expanded, setExpanded] = useState(defaultExpanded || items.length > 0);
  const hasItems = items.length > 0;

  return (
    <div className="border-b border-lichen last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-stone/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-forest">
          {icon}
          <span className="font-medium">{title}</span>
          {hasItems && (
            <span className="text-xs bg-azurite/10 text-azurite px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown size={18} className="text-archive" />
        ) : (
          <ChevronRight size={18} className="text-archive" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          {hasItems ? (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx}>{renderItem(item)}</div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-archive italic">{emptyMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'badge-success-subtle',
  approved: 'badge-success-subtle',
  proposed: 'badge-info-subtle',
  in_progress: 'badge-warning-subtle',
  pending: 'badge-warning-subtle',
  requested: 'badge-info-subtle',
  on_loan: 'badge-warning-subtle',
  returned: 'badge-neutral',
  cancelled: 'badge-neutral',
  rejected: 'badge-danger-subtle',
  draft: 'badge-neutral',
};

function getStatusBadgeClass(status: string): string {
  return STATUS_COLORS[status] || 'badge-neutral';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return formatDateShort(dateStr);
}

export function RelatedProcedures({ organizationId, objectId }: RelatedProceduresProps) {
  const {
    data: procedures,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['object-procedures', organizationId, objectId],
    queryFn: () => getObjectProcedures(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  if (isLoading) {
    return (
      <div className="py-6 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4">
        <div className="flex items-center gap-2 text-sm text-archive">
          <AlertCircle size={16} />
          <span>Failed to load procedures</span>
        </div>
      </div>
    );
  }

  if (!procedures) return null;

  return (
    <div>
        {/* Acquisitions */}
        <ProcedureSection<AcquisitionSummary>
          title="Acquisitions"
          icon={<FileBox size={18} />}
          items={procedures.acquisitions}
          emptyMessage="No acquisition records"
          renderItem={(acq) => (
            <Link
              to={`/organizations/${organizationId}/collections/acquisitions/${acq.acquisition_id}`}
              className="block p-2 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-ink truncate">
                    {acq.acquisition_number}
                  </p>
                  <p className="text-xs text-archive truncate">
                    {acq.acquisition_method}
                    {acq.source_name && ` from ${acq.source_name}`}
                    {acq.acquisition_date && ` - ${formatDate(acq.acquisition_date)}`}
                  </p>
                </div>
                <span className={`text-xs ${getStatusBadgeClass(acq.status)} shrink-0`}>
                  {acq.status}
                </span>
              </div>
            </Link>
          )}
        />

        {/* Loans Out */}
        <ProcedureSection<LoanOutSummary>
          title="Loans Out"
          icon={<ArrowUpRight size={18} />}
          items={procedures.loans_out}
          emptyMessage="No outgoing loans"
          renderItem={(loan) => (
            <Link
              to={`/organizations/${organizationId}/collections/loans-out/${loan.loan_out_id}`}
              className="block p-2 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-ink truncate">
                    {loan.loan_number}
                  </p>
                  <p className="text-xs text-archive truncate">
                    {loan.borrower_name || loan.venue_name || 'Unknown borrower'}
                    {loan.loan_start_date && ` - ${formatDate(loan.loan_start_date)}`}
                    {loan.loan_end_date && ` to ${formatDate(loan.loan_end_date)}`}
                  </p>
                </div>
                <span className={`text-xs ${getStatusBadgeClass(loan.status)} shrink-0`}>
                  {loan.status.replace('_', ' ')}
                </span>
              </div>
            </Link>
          )}
        />

        {/* Conservation */}
        <ProcedureSection<ConservationSummary>
          title="Conservation"
          icon={<Wrench size={18} />}
          items={procedures.conservation}
          emptyMessage="No conservation treatments"
          renderItem={(treatment) => (
            <Link
              to={`/organizations/${organizationId}/collections/conservation/${treatment.treatment_id}`}
              className="block p-2 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-ink truncate">
                    {treatment.treatment_number}
                  </p>
                  <p className="text-xs text-archive truncate">
                    {treatment.treatment_type}
                    {treatment.conservator_name && ` by ${treatment.conservator_name}`}
                    {treatment.start_date && ` - ${formatDate(treatment.start_date)}`}
                  </p>
                </div>
                <span className={`text-xs ${getStatusBadgeClass(treatment.status)} shrink-0`}>
                  {treatment.status.replace('_', ' ')}
                </span>
              </div>
            </Link>
          )}
        />

        {/* Condition Reports */}
        <ProcedureSection<ConditionReportSummary>
          title="Condition Reports"
          icon={<ClipboardCheck size={18} />}
          items={procedures.condition_reports}
          emptyMessage="No condition reports"
          renderItem={(report) => (
            <Link
              to={`/organizations/${organizationId}/collections/condition-reports/${report.report_id}`}
              className="block p-2 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-ink truncate">
                    {report.report_number}
                  </p>
                  <p className="text-xs text-archive truncate">
                    {report.report_type}
                    {report.overall_condition && ` - ${report.overall_condition}`}
                    {report.report_date && ` on ${formatDate(report.report_date)}`}
                  </p>
                </div>
                <span className={`text-xs ${getStatusBadgeClass(report.status)} shrink-0`}>
                  {report.status}
                </span>
              </div>
            </Link>
          )}
        />

        {/* Deaccessions */}
        <ProcedureSection<DeaccessionSummary>
          title="Deaccessions"
          icon={<Trash2 size={18} />}
          items={procedures.deaccessions}
          emptyMessage="No deaccessions"
          renderItem={(deacc) => (
            <Link
              to={`/organizations/${organizationId}/collections/deaccessions/${deacc.deaccession_id}`}
              className="block p-2 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-ink truncate">
                    {deacc.deaccession_number}
                  </p>
                  <p className="text-xs text-archive truncate">
                    {deacc.reason.replace('_', ' ')}
                    {deacc.disposal_method && ` - ${deacc.disposal_method.replace('_', ' ')}`}
                    {deacc.deaccession_date && ` on ${formatDate(deacc.deaccession_date)}`}
                  </p>
                </div>
                <span className={`text-xs ${getStatusBadgeClass(deacc.status)} shrink-0`}>
                  {deacc.status.replace('_', ' ')}
                </span>
              </div>
            </Link>
          )}
        />

        {/* Use Requests */}
        <ProcedureSection<UseRequestSummary>
          title="Use Requests"
          icon={<FileQuestion size={18} />}
          items={procedures.use_requests}
          emptyMessage="No use requests"
          renderItem={(request) => (
            <Link
              to={`/organizations/${organizationId}/collections/use-requests/${request.request_id}`}
              className="block p-2 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-ink truncate">
                    {request.request_number}
                  </p>
                  <p className="text-xs text-archive truncate">
                    {request.use_type.replace('_', ' ')}
                    {request.requester_name && ` by ${request.requester_name}`}
                    {request.requester_institution && ` (${request.requester_institution})`}
                  </p>
                </div>
                <span className={`text-xs ${getStatusBadgeClass(request.status)} shrink-0`}>
                  {request.status.replace('_', ' ')}
                </span>
              </div>
            </Link>
          )}
        />

        {/* Incident Reports */}
        <ProcedureSection<IncidentReportSummary>
          title="Incident Reports"
          icon={<AlertCircle size={18} />}
          items={procedures.incident_reports}
          emptyMessage="No incident reports"
          renderItem={(incident) => (
            <Link
              to={`/organizations/${organizationId}/collections/incidents/${incident.report_id}`}
              className="block p-2 rounded-lg hover:bg-stone/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-ink truncate">
                    {incident.report_number}
                  </p>
                  <p className="text-xs text-archive truncate">
                    {incident.incident_type.replace('_', ' ')}
                    {incident.incident_date && ` on ${formatDate(incident.incident_date)}`}
                  </p>
                </div>
                <span className={`text-xs ${getStatusBadgeClass(incident.status)} shrink-0`}>
                  {incident.status.replace('_', ' ')}
                </span>
              </div>
            </Link>
          )}
        />
    </div>
  );
}

export default RelatedProcedures;
