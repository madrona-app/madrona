import { useQuery } from '@tanstack/react-query';
import {
  getWorkTasks,
  type WorkTasksResponse,
} from '../lib/api/workspaces';
import {
  getApprovals,
  type ApprovalsListResponse,
} from '../lib/api';

const STALE_TIME = 60 * 1000;
const CACHE_TIME = 5 * 60 * 1000;
const SAMPLE_LIMIT = 5;

export function useMyWork(orgId: string | undefined) {
  const tasksQuery = useQuery<WorkTasksResponse, Error>({
    queryKey: ['my-work', 'tasks', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getWorkTasks(orgId, {
        assigned_to: 'me',
        status: 'pending',
        limit: SAMPLE_LIMIT,
      });
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  const approvalsQuery = useQuery<ApprovalsListResponse, Error>({
    queryKey: ['my-work', 'approvals', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getApprovals(orgId, { status: 'pending', limit: SAMPLE_LIMIT });
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  return {
    tasks: tasksQuery.data ?? null,
    approvals: approvalsQuery.data ?? null,
    isLoading: tasksQuery.isLoading || approvalsQuery.isLoading,
    error: tasksQuery.error ?? approvalsQuery.error ?? null,
  };
}
