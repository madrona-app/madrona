import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';

export default function MediaRightsEnforcementSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading } = useQuery<{ enabled: boolean }>({
    queryKey: ['media-rights-enforcement', orgId],
    queryFn: () => apiFetch(`/organizations/${orgId}/settings/media-rights-enforcement`),
    enabled: !!orgId,
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch(`/organizations/${orgId}/settings/media-rights-enforcement`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-rights-enforcement', orgId] });
      showToast({ title: 'Media rights enforcement updated', type: 'success' });
    },
    onError: (error) => {
      showToast({ title: `Failed to update: ${(error as Error).message}`, type: 'error' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading..." />
      </div>
    );
  }

  const enabled = data?.enabled ?? false;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Shield size={20} className="text-bark" />
          Media Rights Enforcement
        </h2>
        <p className="text-sm text-archive mt-1">
          Control whether the media download endpoint enforces rights and permission checks.
          When off, anyone with <code className="text-xs bg-stone/40 px-1 rounded">media.view</code> can
          download any item. When on, downloads are gated by the media&apos;s rights record, the
          user&apos;s download-derivative permission, and unpublished-view permission.
        </p>
      </div>

      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        <div className="px-4 py-4 flex items-start justify-between gap-6 border-b border-lichen">
          <div className="flex items-start gap-3">
            {enabled ? (
              <ShieldCheck size={20} className="text-semantic-success mt-0.5" />
            ) : (
              <ShieldOff size={20} className="text-archive mt-0.5" />
            )}
            <div>
              <div className="text-sm font-medium text-ink">Rights-gated downloads</div>
              <div className="text-xs text-archive mt-1">
                {enabled
                  ? 'Enforcement is ON. Downloads obey MediaRights, MEDIA_VIEW_UNPUBLISHED, and MEDIA_DOWNLOAD_DERIVATIVES.'
                  : 'Enforcement is OFF. Pre-2026-05 behavior: any media.view holder can download anything.'}
              </div>
            </div>
          </div>
          <button
            onClick={() => mutation.mutate(!enabled)}
            disabled={mutation.isPending}
            aria-pressed={enabled}
            aria-label="Toggle media rights enforcement"
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 focus-visible:ring-2 ring-bark/30 ring-offset-2',
              enabled ? 'bg-semantic-success' : 'bg-stone',
              mutation.isPending && 'opacity-50 cursor-not-allowed'
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-parchment transition-transform',
                enabled ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
        </div>

        <div className="px-4 py-4 bg-stone/20 text-xs text-accessible-gray space-y-2">
          <p className="font-medium text-ink">Before turning this on:</p>
          <ul className="list-disc list-inside space-y-1 ml-1">
            <li>
              Make sure your media items have <code className="bg-parchment px-1 rounded">MediaRights</code>
              records assigned, otherwise downloads will return <code className="bg-parchment px-1 rounded">403 download_request_required</code>
              for non-admins (the conservative default).
            </li>
            <li>
              Confirm roles that should download derivatives have the
              <code className="bg-parchment px-1 rounded">media.download_derivatives</code> permission.
            </li>
            <li>
              Confirm roles that should access unpublished media have
              <code className="bg-parchment px-1 rounded">media.view_unpublished</code>.
            </li>
            <li>
              Users with <code className="bg-parchment px-1 rounded">media.admin</code> or
              <code className="bg-parchment px-1 rounded">platform.admin</code> always bypass the rights check.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
