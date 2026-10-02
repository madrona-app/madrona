import { Building2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface DepartmentSelectorProps {
  organizationId: string;
  value: string | null;
  onChange: (departmentId: string | null) => void;
  isEditing: boolean;
  label?: string;
  onBlur?: () => void;
}

export function DepartmentSelector({
  value,
  onChange,
  isEditing,
  label = 'Department',
  onBlur,
}: DepartmentSelectorProps) {
  const { user } = useAuth();
  const departments = user?.department_memberships ?? [];

  const selectedDepartment = departments.find((d) => d.department_id === value);

  if (!isEditing) {
    if (!selectedDepartment) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
        <dd className="text-ink flex items-center gap-2">
          {selectedDepartment.department_color && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: selectedDepartment.department_color }}
            />
          )}
          {selectedDepartment.department_name}
          <span className="text-archive text-sm">({selectedDepartment.department_code})</span>
        </dd>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink flex items-center gap-1.5">
          <Building2 size={14} className="text-archive" />
          {label}
        </span>
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        onBlur={onBlur}
        className="input w-full"
      >
        <option value="">No department</option>
        {departments.map((dept) => (
          <option key={dept.department_id} value={dept.department_id}>
            {dept.department_name} ({dept.department_code})
          </option>
        ))}
      </select>
    </div>
  );
}
