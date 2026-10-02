import { ShieldCheck, User, Search, X } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../workspace';

interface AuthorizationSectionProps {
  /** Current authorizer constituent ID (empty string = not set) */
  authorizerId: string;
  /** Resolved authorizer contact object from useQuery */
  authorizerContact: { name: string; organization_name?: string | null } | undefined;
  /** Authorization date (ISO string or empty) */
  authorizationDate: string;
  /** Authorization notes */
  authorizationNote: string;
  /** Whether the section is in edit mode */
  isEditing: boolean;
  /** Whether the section is expanded */
  isExpanded: boolean;
  /** CSS order for section positioning */
  order: number | undefined;
  /** Toggle section expansion */
  onToggle: () => void;
  /** Update a field value */
  onUpdateField: (field: string, value: string) => void;
  /** Called on field blur (triggers save) */
  onFieldBlur?: () => void;
  /** Open the authorizer constituent selector */
  onOpenAuthorizerSelector: () => void;
  /** Override section title (default: "Authorization") */
  title?: string;
  /** Override section ID (default: "authorization") */
  sectionId?: string;
}

/**
 * Shared authorization section for procedure workspace pages.
 *
 * Displays authorizer (constituent selector), authorization date, and notes.
 * Used by: LoanOut, Movement, ConditionReport, Insurance, Valuation, ObjectExit, Shipments.
 */
export function AuthorizationSection({
  authorizerId,
  authorizerContact,
  authorizationDate,
  authorizationNote,
  isEditing,
  isExpanded,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
  onOpenAuthorizerSelector,
  title = 'Authorization',
  sectionId = 'authorization',
}: AuthorizationSectionProps) {
  return (
    <WorkspaceSection
      id={sectionId}
      title={title}
      icon={<ShieldCheck size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="space-y-4">
        {/* Authorizer — constituent selector */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Authorizer
          </label>
          {isEditing ? (
            <div className="flex items-center gap-2">
              {authorizerId && authorizerContact ? (
                <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                  <User size={16} className="text-archive flex-shrink-0" />
                  <span className="text-sm text-ink">{authorizerContact.name}</span>
                  {authorizerContact.organization_name && (
                    <span className="text-xs text-archive">({authorizerContact.organization_name})</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onUpdateField('authorizer_id', '')}
                    className="ml-auto p-1 text-archive hover:text-semantic-error"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onOpenAuthorizerSelector}
                  className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                >
                  <Search size={16} />
                  Search or create authorizer...
                </button>
              )}
              {authorizerId && (
                <button
                  type="button"
                  onClick={onOpenAuthorizerSelector}
                  className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <div className="text-sm text-ink">
              {authorizerContact ? (
                <span>
                  {authorizerContact.name}
                  {authorizerContact.organization_name && (
                    <span className="text-archive ml-1">({authorizerContact.organization_name})</span>
                  )}
                </span>
              ) : (
                <span className="text-archive">Not specified</span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditableField
            label="Authorization date"
            value={authorizationDate}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('authorization_date', v)}
            onSave={onFieldBlur}
            type="date"
          />
        </div>

        <EditableField
          label="Authorization notes"
          value={authorizationNote}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('authorization_note', v)}
          onSave={onFieldBlur}
          multiline
        />
      </div>
    </WorkspaceSection>
  );
}
