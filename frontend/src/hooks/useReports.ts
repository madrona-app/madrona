/**
 * useReports Hook
 *
 * Fetches and manages reports data for the dashboard.
 * Combines summary, daily runs, and dataset statistics.
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../contexts/useOrganization';
import {
  getReportsSummary,
  getDailyRuns,
  getDatasetsSummary,
  type ReportsSummary,
  type DailyRunsResponse,
  type DatasetsSummaryResponse,
} from '../lib/api';

interface UseReportsOptions {
  days?: number;
  enabled?: boolean;
}

export function useReports(options: UseReportsOptions = {}) {
  const { activeOrganizationId } = useOrganization();
  const { days = 30, enabled = true } = options;

  const isEnabled = enabled && !!activeOrganizationId;

  const summaryQuery = useQuery<ReportsSummary>({
    queryKey: ['reports', 'summary', activeOrganizationId, days],
    queryFn: () => getReportsSummary(activeOrganizationId!, days),
    enabled: isEnabled,
    staleTime: 60000, // 1 minute
  });

  const dailyRunsQuery = useQuery<DailyRunsResponse>({
    queryKey: ['reports', 'daily-runs', activeOrganizationId, days],
    queryFn: () => getDailyRuns(activeOrganizationId!, days),
    enabled: isEnabled,
    staleTime: 60000,
  });

  const datasetsQuery = useQuery<DatasetsSummaryResponse>({
    queryKey: ['reports', 'datasets', activeOrganizationId],
    queryFn: () => getDatasetsSummary(activeOrganizationId!),
    enabled: isEnabled,
    staleTime: 60000,
  });

  const isLoading = summaryQuery.isLoading || dailyRunsQuery.isLoading || datasetsQuery.isLoading;
  const isError = summaryQuery.isError || dailyRunsQuery.isError || datasetsQuery.isError;
  const error = summaryQuery.error || dailyRunsQuery.error || datasetsQuery.error;

  const refetchAll = () => {
    summaryQuery.refetch();
    dailyRunsQuery.refetch();
    datasetsQuery.refetch();
  };

  return {
    summary: summaryQuery.data,
    dailyRuns: dailyRunsQuery.data?.days ?? [],
    datasets: datasetsQuery.data?.datasets ?? [],
    isLoading,
    isError,
    error,
    refetch: refetchAll,
  };
}
