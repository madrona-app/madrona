import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ClipboardCheck, ExternalLink, Loader2 } from 'lucide-react';
import { getObjectProcedures, createConditionReport } from '../../lib/api';
import { formatDateShort } from '../../lib/formatters';
import SlideOver from '../ui/SlideOver';
import { MadronaLoader } from '../ui/MadronaLoader';

interface ConditionReportLinkerProps {
  organizationId: string;
  objectId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

const CONDITION_BADGE_CLASSES: Record<string, string> = {
  excellent: 'bg-semantic-success/10 text-semantic-success',
  good: 'bg-semantic-info/10 text-semantic-info',
  fair: 'bg-semantic-warning/10 text-semantic-warning',
  poor: 'bg-semantic-warning/10 text-semantic-warning',
  critical: 'bg-semantic-error/10 text-semantic-error',
};

const REPORT_TYPE_OPTIONS = [
  { value: 'initial', label: 'Initial' },
  { value: 'periodic', label: 'Periodic' },
  { value: 'loan_out', label: 'Loan Out' },
  { value: 'loan_in', label: 'Loan In' },
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'damage', label: 'Damage' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
];

const CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'critical', label: 'Critical' },
];

/**
 * Component to display and link condition reports to a collection object.
 */
export function ConditionReportLinker({
  organizationId,
  objectId,
  isEditing = false,
  onCountChange: _onCountChange,
}: ConditionReportLinkerProps) {
  const queryClient = useQueryClient();
  const [showSlideOver, setShowSlideOver] = useState(false);

  // Fetch condition reports via procedures endpoint
  const { data: procedures, isLoading } = useQuery({
    queryKey: ['object-procedures', organizationId, objectId],
    queryFn: () => getObjectProcedures(organizationId, objectId),
  });

  const reports = procedures?.condition_reports || [];

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return formatDateShort(dateStr);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink">
          Condition Reports ({reports.length})
        </h4>
        {isEditing && (
          <button
            onClick={() => setShowSlideOver(true)}
            className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
          >
            <Plus size={14} />
            Add Condition Report
          </button>
        )}
      </div>

      {/* Condition Reports List */}
      {isLoading ? (
        <MadronaLoader variant="dots" />
      ) : reports.length === 0 ? (
        <div className="text-sm text-archive italic py-4 text-center">
          No condition reports for this object.
          {isEditing && (
            <button
              onClick={() => setShowSlideOver(true)}
              className="block mx-auto mt-2 text-bark hover:text-copper-dark"
            >
              Add condition report
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((report) => (
            <div
              key={report.report_id}
              className="flex items-center justify-between p-3 border border-lichen rounded-lg bg-parchment"
            >
              <div className="flex items-center gap-3">
                <ClipboardCheck size={16} className="text-archive" />
                <div>
                  <div className="text-sm font-medium text-ink">
                    {report.report_number}
                  </div>
                  <div className="text-xs text-archive">
                    {report.report_type}
                    {report.report_date && ` • ${formatDate(report.report_date)}`}
                    {report.examiner_name && ` • ${report.examiner_name}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {report.overall_condition && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${CONDITION_BADGE_CLASSES[report.overall_condition] || 'bg-stone text-ink'}`}>
                    {report.overall_condition}
                  </span>
                )}
                <Link
                  to={`/organizations/${organizationId}/collections/condition-reports/${report.report_id}`}
                  className="text-bark hover:text-copper-dark p-1"
                  title="View condition report"
                >
                  <ExternalLink size={14} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Condition Report SlideOver */}
      <AddConditionReportSlideOver
        isOpen={showSlideOver}
        organizationId={organizationId}
        objectId={objectId}
        onClose={() => setShowSlideOver(false)}
        onSuccess={() => {
          setShowSlideOver(false);
          queryClient.invalidateQueries({ queryKey: ['object-procedures', organizationId, objectId] });
        }}
      />
    </div>
  );
}

// Add Condition Report SlideOver
interface AddConditionReportSlideOverProps {
  isOpen: boolean;
  organizationId: string;
  objectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddConditionReportSlideOver({
  isOpen,
  organizationId,
  objectId,
  onClose,
  onSuccess,
}: AddConditionReportSlideOverProps) {
  const navigate = useNavigate();
  const [reportType, setReportType] = useState('periodic');
  const [overallCondition, setOverallCondition] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState<string | null>(null);

  // Create condition report mutation
  const createMutation = useMutation({
    mutationFn: () => createConditionReport(organizationId, {
      object_id: objectId,
      report_type: reportType as 'loan_in' | 'loan_out' | 'conservation' | 'incident' | 'intake' | 'periodic',
      overall_condition: (overallCondition || undefined) as 'excellent' | 'good' | 'fair' | 'poor' | 'unacceptable' | null | undefined,
      report_date: reportDate || undefined,
      status: 'draft',
    }),
    onSuccess: (data) => {
      onSuccess();
      // Navigate to the created report so user can fill it out
      navigate(`/organizations/${organizationId}/collections/condition-reports/${data.report_id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    setError(null);
    createMutation.mutate();
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Add Condition Report"
      subtitle="Create a new condition report for this object"
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="btn btn-primary"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Creating...
              </>
            ) : (
              'Create & Edit'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Report Type */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Report Type <span className="text-semantic-error">*</span>
          </label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className="input w-full"
          >
            {REPORT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Report Date */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Report Date
          </label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Overall Condition */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Overall Condition
          </label>
          <select
            value={overallCondition}
            onChange={(e) => setOverallCondition(e.target.value)}
            className="input w-full"
          >
            <option value="">Select condition...</option>
            {CONDITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-archive">
          A draft condition report will be created. You'll be taken to the full form to complete the details.
        </p>
      </div>
    </SlideOver>
  );
}

export default ConditionReportLinker;
