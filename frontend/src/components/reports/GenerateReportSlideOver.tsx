import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Download, AlertCircle, History } from 'lucide-react';
import { SlideOver } from '../ui/SlideOver';
import { MadronaLoader } from '../ui/MadronaLoader';
import { useOrganization } from '../../contexts/useOrganization';
import { useToast } from '../../contexts/ToastContext';
import {
  getAvailableReports,
  generateReport,
} from '../../lib/api/on-demand-reports';
import type {
  ReportContextType,
  ReportFormat,
  AvailableReport,
} from '../../lib/api/on-demand-reports';
import { ReportRunsPanel } from './ReportRunsPanel';

export interface GenerateReportSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  contextType: ReportContextType;
  contextParams: Record<string, unknown>;
  recordType?: string;
  /** Called after a report is successfully queued */
  onGenerated?: (runId: string) => void;
}

const CONTEXT_LABELS: Record<ReportContextType, string> = {
  search: 'search results',
  workspace: 'workspace',
  record: 'this record',
};

const FORMAT_LABELS: Record<ReportFormat, { label: string; icon: typeof FileSpreadsheet }> = {
  csv: { label: 'CSV', icon: FileSpreadsheet },
  excel: { label: 'Excel', icon: FileSpreadsheet },
  pdf: { label: 'PDF', icon: FileText },
};

export function GenerateReportSlideOver({
  isOpen,
  onClose,
  contextType,
  contextParams,
  recordType,
  onGenerated,
}: GenerateReportSlideOverProps) {
  const { activeOrganizationId } = useOrganization();
  const { showToast } = useToast();
  const [selectedReport, setSelectedReport] = useState<AvailableReport | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat | null>(null);
  // Active tab: 'generate' for form, 'history' for past runs
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');
  // Refresh key to force ReportRunsPanel to refetch after new generation
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  // Fetch available reports
  const { data: available, isLoading, error } = useQuery({
    queryKey: ['on-demand-reports', 'available', activeOrganizationId, contextType, recordType],
    queryFn: () => getAvailableReports(activeOrganizationId!, contextType, recordType),
    enabled: isOpen && !!activeOrganizationId,
  });

  // Reset selection when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedReport(null);
      setSelectedFormat(null);
      setActiveTab('generate');
    }
  }, [isOpen]);

  // Auto-select first report if only one available. No toast here —
  // confirming an automatic UI action with a dismissable notification is
  // noise. The user sees the selected state in the list immediately.
  useEffect(() => {
    if (available?.reports.length === 1 && !selectedReport) {
      const report = available.reports[0];
      setSelectedReport(report);
      setSelectedFormat(report.default_format as ReportFormat);
    }
  }, [available, selectedReport]);

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: () => {
      if (!activeOrganizationId || !selectedReport || !selectedFormat) {
        throw new Error('Missing required fields');
      }
      return generateReport(activeOrganizationId, {
        report_key: selectedReport.report_key,
        context_type: contextType,
        context_params: contextParams,
        export_format: selectedFormat,
      });
    },
    onSuccess: (data) => {
      // Brief acknowledgment ping — the onSuccess handler also switches
      // tabs to history, but the tab indicator is at the top of the
      // slide-over while the user's focal point is the Generate button
      // at the bottom. Without a top-right acknowledgment they may not
      // register that the click landed. Short duration, no message body;
      // completion/failure of the async run is a separate signal that
      // belongs to ReportRunsPanel (polling transition) or the
      // WebSocket notification path, not here.
      showToast({
        type: 'info',
        title: `Generating ${selectedReport?.name}…`,
        duration: 3000,
      });
      setActiveTab('history');
      setRunsRefreshKey((k) => k + 1);
      onGenerated?.(data.run_id);
    },
    onError: (error: Error) => {
      showToast({
        type: 'error',
        title: 'Failed to generate report',
        message: error.message,
      });
    },
  });

  const handleSelectReport = useCallback((report: AvailableReport) => {
    setSelectedReport(report);
    setSelectedFormat(report.default_format as ReportFormat);
  }, []);

  const handleGenerate = useCallback(() => {
    generateMutation.mutate();
  }, [generateMutation]);

  // Group reports by category
  const reportsByCategory = (available?.reports || []).reduce<Record<string, AvailableReport[]>>(
    (acc, report) => {
      const cat = report.category || 'Other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(report);
      return acc;
    },
    {},
  );

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Report"
      subtitle={`Export from ${CONTEXT_LABELS[contextType]}`}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary px-4 py-2 text-sm"
          >
            {activeTab === 'history' ? 'Close' : 'Cancel'}
          </button>
          {activeTab === 'generate' && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!selectedReport || !selectedFormat || generateMutation.isPending}
              className="btn-primary px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generateMutation.isPending ? (
                <MadronaLoader variant="dots" dotSize={6} />
              ) : (
                <Download size={16} />
              )}
              Generate
            </button>
          )}
        </div>
      }
    >
      {/* Tab switcher */}
      <div className="flex border-b border-lichen mb-4 -mt-1">
        <button
          type="button"
          onClick={() => setActiveTab('generate')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'generate'
              ? 'border-bark text-bark'
              : 'border-transparent text-archive hover:text-ink'
          }`}
        >
          <FileSpreadsheet size={14} />
          Generate
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'history'
              ? 'border-bark text-bark'
              : 'border-transparent text-archive hover:text-ink'
          }`}
        >
          <History size={14} />
          Your Reports
        </button>
      </div>

      {renderBody()}
    </SlideOver>
  );

  // Body render — early returns keep the five branches readable instead
  // of a five-level nested ternary. Closure access to state/props is
  // preserved without threading props.
  function renderBody() {
    if (activeTab === 'history') {
      return <ReportRunsPanel refreshKey={runsRefreshKey} />;
    }
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <MadronaLoader variant="dots" />
        </div>
      );
    }
    if (error) {
      return (
        <div className="text-center py-12">
          <AlertCircle size={32} className="mx-auto text-semantic-error mb-3" />
          <p className="text-sm text-semantic-error">Failed to load available reports</p>
          <p className="text-xs text-archive mt-1">Please close and try again.</p>
        </div>
      );
    }
    if (!available?.reports.length) {
      return (
        <div className="text-center py-12">
          <FileSpreadsheet size={32} className="mx-auto text-archive mb-3" />
          <p className="text-sm text-archive">No reports available for this context.</p>
        </div>
      );
    }
    return (
      <div className="space-y-6">
          {/* Report Selection */}
          {Object.entries(reportsByCategory).map(([category, reports]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-archive uppercase tracking-wider mb-2">
                {category}
              </h3>
              <div className="space-y-2">
                {reports.map((report) => (
                  <button
                    key={report.report_key}
                    type="button"
                    onClick={() => handleSelectReport(report)}
                    disabled={generateMutation.isPending}
                    className={`w-full text-left p-3 rounded-institutional border transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                      selectedReport?.report_key === report.report_key
                        ? 'border-bark bg-bark/5'
                        : 'border-lichen hover:border-stone hover:bg-stone/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 ${
                        selectedReport?.report_key === report.report_key
                          ? 'text-bark'
                          : 'text-archive'
                      }`}>
                        {report.style === 'document' ? (
                          <FileText size={18} />
                        ) : (
                          <FileSpreadsheet size={18} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${
                          selectedReport?.report_key === report.report_key
                            ? 'text-bark'
                            : 'text-ink'
                        }`}>
                          {report.name}
                        </p>
                        <p className="text-xs text-archive mt-0.5">
                          {report.description}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Format Selection */}
          {selectedReport && (
            <div>
              <h3 className="text-xs font-semibold text-archive uppercase tracking-wider mb-2">
                Export Format
              </h3>
              <div className="flex gap-2">
                {selectedReport.supported_formats.map((format) => {
                  const { label, icon: Icon } = FORMAT_LABELS[format as ReportFormat] || {
                    label: format.toUpperCase(),
                    icon: FileSpreadsheet,
                  };
                  return (
                    <button
                      key={format}
                      type="button"
                      onClick={() => setSelectedFormat(format as ReportFormat)}
                      disabled={generateMutation.isPending}
                      className={`flex items-center gap-2 px-4 py-2 rounded-institutional border text-sm transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                        selectedFormat === format
                          ? 'border-bark bg-bark/5 text-bark font-medium'
                          : 'border-lichen text-ink hover:border-stone hover:bg-stone/30'
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
      </div>
    );
  }
}

export default GenerateReportSlideOver;
