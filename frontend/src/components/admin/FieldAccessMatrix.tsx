import { useState, useCallback, useMemo } from 'react';
import Checkbox from '../Checkbox';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, AlertTriangle, Shield } from 'lucide-react';
import {
  getFieldPolicies,
  getFieldGrants,
  updateFieldGrants,
  type FieldAccessPolicy,
  type FieldGrantInput,
} from '../../lib/api/admin';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../ui/MadronaLoader';

interface FieldAccessMatrixProps {
  roleId: string;
  organizationId: string;
}

interface GrantState {
  can_view: boolean;
  can_edit: boolean;
}

export function FieldAccessMatrix({ roleId, organizationId }: FieldAccessMatrixProps) {
  const queryClient = useQueryClient();
  const [localGrants, setLocalGrants] = useState<Record<string, GrantState>>({});
  const [isDirty, setIsDirty] = useState(false);

  // Fetch policies
  const {
    data: policiesData,
    isLoading: policiesLoading,
    error: policiesError,
  } = useQuery({
    queryKey: ['field-policies', organizationId],
    queryFn: () => getFieldPolicies(organizationId),
  });

  // Fetch grants for the selected role
  const {
    data: grantsData,
    isLoading: grantsLoading,
    error: grantsError,
  } = useQuery({
    queryKey: ['field-grants', organizationId, roleId],
    queryFn: () => getFieldGrants(organizationId, roleId),
    enabled: !!roleId,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (grants: FieldGrantInput[]) =>
      updateFieldGrants(organizationId, roleId, grants),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-grants', organizationId, roleId] });
      setIsDirty(false);
    },
    onError: (err) => {
      logger.error('Failed to save field grants:', err);
    },
  });

  // Build merged grant state: server grants + local overrides
  const grantMap = useMemo(() => {
    const map: Record<string, GrantState> = {};

    // Initialize from server grants
    if (grantsData?.grants) {
      for (const grant of grantsData.grants) {
        map[grant.policy_id] = {
          can_view: grant.can_view,
          can_edit: grant.can_edit,
        };
      }
    }

    // Overlay local changes
    for (const [policyId, state] of Object.entries(localGrants)) {
      map[policyId] = state;
    }

    return map;
  }, [grantsData, localGrants]);

  // Group policies by entity type
  const groupedPolicies = useMemo(() => {
    if (!policiesData?.policies) return {};

    const groups: Record<string, FieldAccessPolicy[]> = {};
    for (const policy of policiesData.policies) {
      const key = policy.entity_type;
      if (!groups[key]) groups[key] = [];
      groups[key].push(policy);
    }
    return groups;
  }, [policiesData]);

  const handleToggle = useCallback(
    (policyId: string, field: 'can_view' | 'can_edit') => {
      setLocalGrants((prev) => {
        const current = prev[policyId] || grantMap[policyId] || { can_view: false, can_edit: false };
        const updated = { ...current };
        updated[field] = !updated[field];

        // If disabling view, also disable edit
        if (field === 'can_view' && !updated.can_view) {
          updated.can_edit = false;
        }
        // If enabling edit, also enable view
        if (field === 'can_edit' && updated.can_edit) {
          updated.can_view = true;
        }

        return { ...prev, [policyId]: updated };
      });
      setIsDirty(true);
    },
    [grantMap]
  );

  const handleSave = useCallback(() => {
    if (!policiesData?.policies) return;

    // Build grants array from all policies with their current state
    const grants: FieldGrantInput[] = policiesData.policies.map((policy) => {
      const state = localGrants[policy.policy_id] || grantMap[policy.policy_id] || { can_view: false, can_edit: false };
      return {
        policy_id: policy.policy_id,
        can_view: state.can_view,
        can_edit: state.can_edit,
      };
    });

    saveMutation.mutate(grants);
  }, [policiesData, localGrants, grantMap, saveMutation]);

  // Reset local changes when role changes
  const prevRoleId = useMemo(() => roleId, [roleId]);
  if (prevRoleId !== roleId) {
    setLocalGrants({});
    setIsDirty(false);
  }

  const isLoading = policiesLoading || grantsLoading;
  const error = policiesError || grantsError;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader variant="dots" />
        <span className="ml-2 text-archive">Loading field policies...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-semantic-error/10 text-semantic-error rounded-lg flex items-center gap-2">
        <AlertTriangle size={18} />
        <span>Failed to load field access data: {error instanceof Error ? error.message : 'Unknown error'}</span>
      </div>
    );
  }

  const entityTypes = Object.keys(groupedPolicies);

  if (entityTypes.length === 0) {
    return (
      <div className="text-center py-12">
        <Shield className="mx-auto mb-3 text-archive" size={40} />
        <p className="text-archive">No field access policies configured.</p>
        <p className="text-sm text-archive mt-1">
          Field policies define which fields require access control.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Save bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-archive">
          Configure which fields this role can view and edit.
        </p>
        <button
          onClick={handleSave}
          disabled={!isDirty || saveMutation.isPending}
          className="btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Changes
        </button>
      </div>

      {/* Success/error messages */}
      {saveMutation.isSuccess && (
        <div className="p-3 bg-semantic-success/10 text-semantic-success rounded-lg text-sm">
          Field access grants saved successfully.
        </div>
      )}
      {saveMutation.isError && (
        <div className="p-3 bg-semantic-error/10 text-semantic-error rounded-lg text-sm">
          Failed to save: {saveMutation.error instanceof Error ? saveMutation.error.message : 'Unknown error'}
        </div>
      )}

      {/* Matrix tables grouped by entity type */}
      {entityTypes.map((entityType) => {
        const policies = groupedPolicies[entityType];
        const label = entityType
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());

        return (
          <div key={entityType} className="border border-lichen rounded-lg overflow-hidden">
            <div className="bg-stone px-4 py-2">
              <h3 className="text-sm font-semibold text-ink">{label}</h3>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-lichen bg-parchment">
                  <th className="text-left px-4 py-2 text-xs font-medium text-archive uppercase tracking-wide">
                    Field
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-archive uppercase tracking-wide w-20">
                    Type
                  </th>
                  <th className="text-center px-4 py-2 text-xs font-medium text-archive uppercase tracking-wide w-20">
                    View
                  </th>
                  <th className="text-center px-4 py-2 text-xs font-medium text-archive uppercase tracking-wide w-20">
                    Edit
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => {
                  const state = grantMap[policy.policy_id] || {
                    can_view: false,
                    can_edit: false,
                  };
                  const isModified = !!localGrants[policy.policy_id];

                  return (
                    <tr
                      key={policy.policy_id}
                      className={`border-b border-lichen last:border-b-0 ${
                        isModified ? 'bg-bark/5' : 'hover:bg-stone/50'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="text-sm text-ink font-medium">
                          {policy.display_name}
                        </div>
                        {policy.description && (
                          <div className="text-xs text-archive mt-0.5">
                            {policy.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            policy.policy_type === 'sensitive'
                              ? 'bg-semantic-error/10 text-semantic-error'
                              : policy.policy_type === 'restricted'
                                ? 'bg-semantic-warning/10 text-semantic-warning'
                                : 'bg-semantic-info/10 text-semantic-info'
                          }`}
                        >
                          {policy.policy_type}
                        </span>
                      </td>
                      <td className="text-center px-4 py-2.5">
                        <Checkbox
                          checked={state.can_view}
                          onChange={() => handleToggle(policy.policy_id, 'can_view')}
                        />
                      </td>
                      <td className="text-center px-4 py-2.5">
                        <Checkbox
                          checked={state.can_edit}
                          onChange={() => handleToggle(policy.policy_id, 'can_edit')}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
