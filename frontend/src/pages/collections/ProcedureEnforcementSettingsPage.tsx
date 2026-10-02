import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';

interface ProcedureInfo {
  enabled: boolean;
  label: string;
  requirement_count: number;
  blocking_count: number;
}

export default function ProcedureEnforcementSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading } = useQuery<{ procedures: Record<string, ProcedureInfo> }>({
    queryKey: ['procedure-enforcement', orgId],
    queryFn: () => apiFetch(`/organizations/${orgId}/settings/procedure-enforcement`),
    enabled: !!orgId,
  });

  const mutation = useMutation({
    mutationFn: (updates: Record<string, boolean>) =>
      apiFetch(`/organizations/${orgId}/settings/procedure-enforcement`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procedure-enforcement', orgId] });
      // Also invalidate cached requirements so enforcement flag refreshes
      queryClient.invalidateQueries({ queryKey: ['procedure-requirements'] });
      showToast({ title: 'Enforcement settings updated', type: 'success' });
    },
    onError: (error) => {
      showToast({ title: `Failed to update: ${(error as Error).message}`, type: 'error' });
    },
  });

  const toggleProcedure = (procedureType: string, enabled: boolean) => {
    mutation.mutate({ [procedureType]: enabled });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading..." />
      </div>
    );
  }

  const procedures = data?.procedures || {};
  const sortedProcedures = Object.entries(procedures).sort(([, a], [, b]) => a.label.localeCompare(b.label));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Shield size={20} className="text-bark" />
          Procedure Enforcement
        </h2>
        <p className="text-sm text-archive mt-1">
          Control whether procedure requirements block status transitions.
          When enforcement is off, requirements are shown as advisory warnings but don't prevent advancement.
        </p>
      </div>

      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-stone/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Procedure</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-ink">Requirements</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-ink">Blocking</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-ink">Enforcement</th>
            </tr>
          </thead>
          <tbody>
            {sortedProcedures.map(([procedureType, info]) => (
              <tr key={procedureType} className="border-t border-lichen">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {info.enabled ? (
                      <ShieldCheck size={16} className="text-semantic-success" />
                    ) : (
                      <ShieldOff size={16} className="text-archive" />
                    )}
                    <span className="text-sm font-medium text-ink">{info.label}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-sm text-archive">
                  {info.requirement_count}
                </td>
                <td className="px-4 py-3 text-center text-sm text-archive">
                  {info.blocking_count}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleProcedure(procedureType, !info.enabled)}
                    disabled={mutation.isPending}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                      info.enabled ? 'bg-semantic-success' : 'bg-stone'
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-4 w-4 transform rounded-full bg-parchment transition-transform',
                        info.enabled ? 'translate-x-6' : 'translate-x-1'
                      )}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-archive mt-4">
        When enforcement is enabled, staff cannot advance a record past a status gate without completing all blocking requirements.
        Requirements are still visible when enforcement is off — they serve as guidance without blocking workflow.
      </p>
    </div>
  );
}
