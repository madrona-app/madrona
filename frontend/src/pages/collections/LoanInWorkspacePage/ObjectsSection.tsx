import { Link } from 'react-router-dom';
import { Package, LogOut, ClipboardList, RefreshCw } from 'lucide-react';
import { formatDateShort } from '@/lib/formatters';
import {
  WorkspaceSection,
  EditableField,
} from '../../../components/workspace';
import { LoanEntryLinker } from '../../../components/collections/LoanEntryLinker';
import { LoanExitLinker } from '../../../components/collections/LoanExitLinker';
import type { FormData } from './types';
import type { LoanIn } from '../../../lib/schemas';

interface ObjectsSectionProps {
  orgId: string;
  loanId: string;
  formData: FormData;
  loan: LoanIn | undefined;
  isEditing: boolean;
  isCreateMode: boolean;
  expandedSections: Record<string, boolean>;
  lenderContact: { name: string } | undefined;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  toggleSection: (sectionId: string) => void;
  getSectionOrder: (sectionId: string) => number | undefined;
}

export function ObjectsSection({
  orgId,
  loanId,
  formData,
  loan,
  isEditing,
  isCreateMode,
  expandedSections,
  lenderContact,
  updateField,
  toggleSection,
  getSectionOrder,
}: ObjectsSectionProps) {
  if (isCreateMode) {
    return null;
  }

  return (
    <>
      {/* Loan Objects */}
      <WorkspaceSection
        id="linkedEntry"
        title="Loan Objects"
        icon={<Package size={20} />}
        isExpanded={expandedSections.linkedEntry}
        onToggle={() => toggleSection('linkedEntry')}
        isEditing={isEditing}
        order={getSectionOrder('linkedEntry')}
      >
        <LoanEntryLinker
          organizationId={orgId}
          loanId={loanId}
          isEditing={isEditing}
        />
      </WorkspaceSection>

      {/* Linked Object Exits */}
      <WorkspaceSection
        id="linkedExit"
        title="Object Exits"
        icon={<LogOut size={20} />}
        isExpanded={expandedSections.linkedExit}
        onToggle={() => toggleSection('linkedExit')}
        isEditing={isEditing}
        order={getSectionOrder('linkedExit')}
      >
        <LoanExitLinker
          organizationId={orgId}
          loanId={loanId}
          lenderName={lenderContact?.name}
          isEditing={isEditing}
        />
      </WorkspaceSection>

      {/* Condition Reports */}
      <WorkspaceSection
        id="condition-reports"
        title="Condition Reports"
        icon={<ClipboardList size={20} />}
        isExpanded={expandedSections['condition-reports']}
        onToggle={() => toggleSection('condition-reports')}
        isEditing={isEditing}
        order={getSectionOrder('condition-reports')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-ink mb-2">Condition Report (Receipt)</h4>
              {loan?.condition_report_in_id ? (
                <Link
                  to={`/organizations/${orgId}/collections/condition-reports/${loan.condition_report_in_id}`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View condition report
                </Link>
              ) : (
                <div className="text-sm text-archive">
                  <p className="mb-2">No condition report on receipt yet.</p>
                  {isEditing && (
                    <Link
                      to={`/organizations/${orgId}/collections/condition-reports/create?reference_type=loan_in&reference_id=${loanId}&report_type=incoming`}
                      className="text-bark hover:text-copper-dark"
                    >
                      Create condition report
                    </Link>
                  )}
                </div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-medium text-ink mb-2">Condition Report (Return)</h4>
              {loan?.condition_report_out_id ? (
                <Link
                  to={`/organizations/${orgId}/collections/condition-reports/${loan.condition_report_out_id}`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View condition report
                </Link>
              ) : (
                <div className="text-sm text-archive">
                  <p className="mb-2">No condition report for return yet.</p>
                  {isEditing && (
                    <Link
                      to={`/organizations/${orgId}/collections/condition-reports/create?reference_type=loan_in&reference_id=${loanId}&report_type=outgoing`}
                      className="text-bark hover:text-copper-dark"
                    >
                      Create condition report
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </WorkspaceSection>

      {/* Renewals */}
      <WorkspaceSection
        id="renewals"
        title="Renewals"
        icon={<RefreshCw size={20} />}
        isExpanded={expandedSections.renewals}
        onToggle={() => toggleSection('renewals')}
        isEditing={isEditing}
        order={getSectionOrder('renewals')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <dt className="text-sm font-medium text-archive mb-1">Renewals Used</dt>
              <dd className="text-ink">{loan?.renewal_count || 0}</dd>
            </div>
            <EditableField
              value={formData.max_renewals}
              label="Maximum Renewals Allowed"
              isEditing={isEditing}
              onChange={(v) => updateField('max_renewals', v)}
              type="number"
              placeholder="2"
            />
          </div>
          {loan?.renewal_history && loan.renewal_history.length > 0 ? (
            <div className="mt-4 pt-4 border-t border-lichen">
              <h4 className="text-sm font-medium text-ink mb-2">Renewal History</h4>
              <div className="space-y-2">
                {loan.renewal_history.map((renewal, index: number) => (
                  <div key={index} className="text-sm p-2 bg-stone/30 rounded">
                    <span className="font-medium">Renewal {index + 1}</span>
                    {renewal.approval_date && <span className="text-archive ml-2">({formatDateShort(renewal.approval_date)})</span>}
                    {renewal.new_end_date && <span className="ml-2">New end date: {formatDateShort(renewal.new_end_date)}</span>}
                    {renewal.note && <p className="text-archive mt-1">{renewal.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-archive">No renewals have been recorded for this loan.</p>
          )}
        </div>
      </WorkspaceSection>
    </>
  );
}
