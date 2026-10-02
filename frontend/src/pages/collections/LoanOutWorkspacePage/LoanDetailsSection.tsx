import { FileText } from 'lucide-react';
import { WorkspaceSection, EditableField, EditableSelect } from '../../../components/workspace';
import type { LookupOption } from '../../../hooks/useLookupValues';
import type { FormData } from './types';

interface LoanDetailsSectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
  loanPurposeOptions: LookupOption[];
  isRestricted: (field: string) => boolean;
  orgId: string;
}

export function LoanDetailsSection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
  loanPurposeOptions,
  isRestricted,
  orgId: _orgId,
}: LoanDetailsSectionProps) {
  return (
    <WorkspaceSection
      id="details"
      title="Loan Details"
      icon={<FileText size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EditableSelect
          label="Loan Purpose"
          value={formData.loan_purpose}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('loan_purpose', v)}
          onSave={onFieldBlur}
          options={loanPurposeOptions}
          required
        />
        <EditableField
          label="Exhibition Title"
          value={formData.exhibition_title}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('exhibition_title', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          label="Loan Conditions"
          value={formData.loan_conditions}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('loan_conditions', v)}
          onSave={onFieldBlur}
          multiline
          rows={3}
          className="md:col-span-2"
          restricted={isRestricted('loan_conditions')}
        />

        <EditableField
          label="Special Conditions of Loan"
          value={formData.special_conditions}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('special_conditions', v)}
          onSave={onFieldBlur}
          multiline
          rows={3}
          className="md:col-span-2"
          helpText="Indemnity or insurance provisions, specific requirements for display, handling, or security"
          restricted={isRestricted('special_conditions')}
        />

        {/* Photography permitted */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-ink mb-1.5">
            Photography permitted
          </label>
          {isEditing ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onUpdateField('photography_permitted', true);
                  onFieldBlur();
                }}
                className={`px-3 py-1.5 text-sm rounded-l-lg border transition-colors ${
                  formData.photography_permitted === true
                    ? 'bg-bark text-parchment border-bark'
                    : 'bg-parchment text-ink border-lichen hover:bg-stone'
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateField('photography_permitted', false);
                  onFieldBlur();
                }}
                className={`px-3 py-1.5 text-sm border-y transition-colors ${
                  formData.photography_permitted === false
                    ? 'bg-bark text-parchment border-bark'
                    : 'bg-parchment text-ink border-lichen hover:bg-stone'
                }`}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateField('photography_permitted', null);
                  onFieldBlur();
                }}
                className={`px-3 py-1.5 text-sm rounded-r-lg border transition-colors ${
                  formData.photography_permitted === null
                    ? 'bg-bark text-parchment border-bark'
                    : 'bg-parchment text-ink border-lichen hover:bg-stone'
                }`}
              >
                Not specified
              </button>
            </div>
          ) : (
            <div className="text-sm text-ink">
              {formData.photography_permitted === true && 'Yes'}
              {formData.photography_permitted === false && 'No'}
              {formData.photography_permitted === null && (
                <span className="text-archive">Not specified</span>
              )}
            </div>
          )}
        </div>

        {/* Photography conditions - only shown when photography is permitted */}
        {formData.photography_permitted === true && (
          <EditableField
            label="Photography conditions"
            value={formData.photography_conditions}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('photography_conditions', v)}
            onSave={onFieldBlur}
            multiline
            rows={3}
            className="md:col-span-2"
            helpText="What photography is permitted and under what conditions"
          />
        )}

        {/* Reproduction & intellectual property rights */}
        <EditableField
          label="Reproduction & intellectual property rights"
          value={formData.reproduction_rights_note}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('reproduction_rights_note', v)}
          onSave={onFieldBlur}
          multiline
          rows={3}
          className="md:col-span-2"
        />
      </div>
    </WorkspaceSection>
  );
}
