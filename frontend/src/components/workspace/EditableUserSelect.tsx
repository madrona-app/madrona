/**
 * A staff-member select for record columns that point at a user
 * (e.g. object exit `authorization_id`). Lists the organization's assignable
 * users and behaves like EditableSelect, including `name` for required-field
 * marking and server-reported errors.
 */
import { useQuery } from '@tanstack/react-query';
import { getAssignableUsers } from '../../lib/api/workspaces';
import { EditableSelect } from './EditableField';

interface EditableUserSelectProps {
  organizationId: string | undefined;
  value: string;
  label: string;
  isEditing: boolean;
  onChange: (userId: string) => void;
  name?: string;
  required?: boolean;
  helpText?: string;
  className?: string;
  placeholder?: string;
  /** Shown in view mode when the user is not in the assignable list. */
  fallbackName?: string | null;
}

export function EditableUserSelect({
  organizationId,
  value,
  label,
  isEditing,
  onChange,
  name,
  required,
  helpText,
  className,
  placeholder = 'Select a staff member...',
  fallbackName,
}: EditableUserSelectProps) {
  const { data } = useQuery({
    queryKey: ['assignable-users', organizationId],
    queryFn: () => getAssignableUsers(organizationId!),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
  const options = (data?.users ?? []).map((u) => ({ value: u.user_id, label: u.name || u.email }));
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: fallbackName || 'Current selection' });
  }
  return (
    <EditableSelect
      name={name}
      value={value}
      label={label}
      isEditing={isEditing}
      onChange={onChange}
      options={options}
      required={required}
      helpText={helpText}
      className={className}
      placeholder={placeholder}
    />
  );
}
