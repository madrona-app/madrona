import { ShieldCheck, User, Search, X } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import type { FormData, Contact } from './types';

interface AuthorizationSectionProps {
  formData: FormData;
  authorizerContact: Contact | undefined;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
  onOpenAuthorizerSelector: () => void;
}

export function AuthorizationSection({
  formData,
  authorizerContact,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
  onOpenAuthorizerSelector,
}: AuthorizationSectionProps) {
  return (
    <WorkspaceSection
      id="authorization"
      title="Authorization"
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
              {formData.authorizer_id && authorizerContact ? (
                <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                  <User size={16} className="text-archive flex-shrink-0" />
                  <span className="text-sm text-ink">{authorizerContact.name}</span>
                  {authorizerContact.organization_name && (
                    <span className="text-xs text-archive">({authorizerContact.organization_name})</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateField('authorizer_id', '');
                    }}
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
              {formData.authorizer_id && (
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
            value={formData.authorization_date}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('authorization_date', v)}
            onSave={onFieldBlur}
            type="date"
          />
        </div>

        <EditableField
          label="Authorization notes"
          value={formData.authorization_note}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('authorization_note', v)}
          onSave={onFieldBlur}
          multiline
        />
      </div>
    </WorkspaceSection>
  );
}
