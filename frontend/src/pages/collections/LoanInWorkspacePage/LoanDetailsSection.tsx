import { FileText, Search, X } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditableSelect,
} from '../../../components/workspace';
import { SectionCompletionBadge } from '../../../components/collections/SectionCompletionBadge';
import type { SectionCompletion } from '../../../lib/procedureValidation';
import type { FormData } from './types';
import type { LookupOption } from '../../../hooks/useLookupValues';

interface Exhibition {
  exhibition_id: string;
  title: string;
  exhibition_number?: string | null;
}

interface LoanDetailsSectionProps {
  formData: FormData;
  isEditing: boolean;
  isCreateMode: boolean;
  expandedSections: Record<string, boolean>;
  sectionCompletions: Record<string, SectionCompletion>;
  linkedExhibition: Exhibition | undefined;
  exhibitionSearchResults: { exhibitions?: Exhibition[] } | undefined;
  showExhibitionSelector: boolean;
  exhibitionSearch: string;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  toggleSection: (sectionId: string) => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  setShowExhibitionSelector: (show: boolean) => void;
  setExhibitionSearch: (search: string) => void;
  loanPurposeOptions: LookupOption[];
  isRestricted: (field: string) => boolean;
  orgId: string;
}

export function LoanDetailsSection({
  formData,
  isEditing,
  isCreateMode,
  expandedSections,
  sectionCompletions,
  linkedExhibition,
  exhibitionSearchResults,
  showExhibitionSelector,
  exhibitionSearch,
  updateField,
  toggleSection,
  getSectionOrder,
  setShowExhibitionSelector,
  setExhibitionSearch,
  loanPurposeOptions,
  isRestricted,
  orgId: _orgId,
}: LoanDetailsSectionProps) {
  return (
    <WorkspaceSection
      id="details"
      title="Loan Details"
      icon={<FileText size={20} />}
      isExpanded={expandedSections.details}
      onToggle={() => toggleSection('details')}
      isEditing={isEditing}
      order={getSectionOrder('details')}
      badge={!isCreateMode && sectionCompletions.details && (
        <SectionCompletionBadge completion={sectionCompletions.details} />
      )}
    >
      <div className="grid grid-cols-2 gap-6">
        <EditableSelect
          value={formData.loan_purpose}
          label="Loan Purpose"
          isEditing={isEditing}
          onChange={(v) => updateField('loan_purpose', v)}
          options={loanPurposeOptions}
          required
        />
        {formData.loan_purpose === 'exhibition' && (
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Exhibition
            </label>
            {isEditing ? (
              <div className="relative">
                {formData.exhibition_id && linkedExhibition ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                      <span className="text-sm text-ink">{linkedExhibition.title}</span>
                      {linkedExhibition.exhibition_number && (
                        <span className="text-xs text-archive">({linkedExhibition.exhibition_number})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => updateField('exhibition_id', '')}
                        className="ml-auto p-1 text-archive hover:text-semantic-error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowExhibitionSelector(true)}
                      className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowExhibitionSelector(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search exhibitions...
                    </button>
                    {showExhibitionSelector && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-parchment border border-lichen rounded-lg shadow-lg max-h-64 overflow-y-auto">
                        <div className="p-2 border-b border-lichen">
                          <input
                            type="text"
                            value={exhibitionSearch}
                            onChange={(e) => setExhibitionSearch(e.target.value)}
                            placeholder="Search by title..."
                            className="w-full px-3 py-2 border border-lichen rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                            autoFocus
                          />
                        </div>
                        <div className="py-1">
                          {exhibitionSearchResults?.exhibitions?.map((exhibition) => (
                            <button
                              key={exhibition.exhibition_id}
                              type="button"
                              onClick={() => {
                                updateField('exhibition_id', exhibition.exhibition_id);
                                setShowExhibitionSelector(false);
                                setExhibitionSearch('');
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center justify-between"
                            >
                              <span className="text-ink">{exhibition.title}</span>
                              {exhibition.exhibition_number && (
                                <span className="text-xs text-archive">{exhibition.exhibition_number}</span>
                              )}
                            </button>
                          ))}
                          {exhibitionSearchResults?.exhibitions?.length === 0 && (
                            <div className="px-3 py-2 text-sm text-archive">No exhibitions found</div>
                          )}
                        </div>
                        <div className="p-2 border-t border-lichen">
                          <button
                            type="button"
                            onClick={() => {
                              setShowExhibitionSelector(false);
                              setExhibitionSearch('');
                            }}
                            className="w-full px-3 py-1.5 text-sm text-archive hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink">
                {linkedExhibition ? (
                  <span>
                    {linkedExhibition.title}
                    {linkedExhibition.exhibition_number && (
                      <span className="text-archive ml-1">({linkedExhibition.exhibition_number})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-archive">Not linked to an exhibition</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-6 space-y-6">
        <EditableField
          value={formData.loan_conditions}
          label="Loan Conditions"
          isEditing={isEditing}
          onChange={(v) => updateField('loan_conditions', v)}
          multiline
          rows={3}
          placeholder="Lender's conditions for the loan..."
          restricted={isRestricted('loan_conditions')}
        />
        <EditableField
          value={formData.special_requirements}
          label="Special Requirements"
          isEditing={isEditing}
          onChange={(v) => updateField('special_requirements', v)}
          multiline
          rows={3}
          placeholder="Environmental, security, or handling requirements..."
          restricted={isRestricted('special_requirements')}
        />
        <EditableField
          value={formData.display_requirements}
          label="Display Requirements"
          isEditing={isEditing}
          onChange={(v) => updateField('display_requirements', v)}
          multiline
          rows={3}
          placeholder="Lighting, mounting, case requirements..."
        />
        <EditableField
          value={formData.photography_restrictions}
          label="Photography Restrictions"
          isEditing={isEditing}
          onChange={(v) => updateField('photography_restrictions', v)}
          multiline
          rows={2}
          placeholder="Any restrictions on photography of the objects..."
        />
      </div>
    </WorkspaceSection>
  );
}
