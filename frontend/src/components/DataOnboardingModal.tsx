import { useState, useCallback } from 'react';
import Checkbox from './Checkbox';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  getOnboardingProfiles,
  analyzeForOnboarding,
  previewOnboarding,
  executeOnboarding,
  type OnboardingProfile,
  type OnboardingAnalysis,
  type OnboardingPreview,
  type OnboardingResult,
  type MappingSuggestion,
} from '../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { useToast } from '../contexts/ToastContext';
import { ModalPortal } from './ModalPortal';

type Step = 'upload' | 'analyze' | 'map' | 'preview' | 'execute' | 'complete';

interface DataOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (result: OnboardingResult) => void;
}

export default function DataOnboardingModal({
  isOpen,
  onClose,
  onComplete,
}: DataOnboardingModalProps) {
  const { showToast } = useToast();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'data-onboarding',
  });

  // Step state
  const [step, setStep] = useState<Step>('upload');

  // Data state
  const [records, setRecords] = useState<any[]>([]);
  const [targetProfile, setTargetProfile] = useState<string>('');
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<OnboardingAnalysis | null>(null);
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);

  // Options
  const [autoEnrich, setAutoEnrich] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(true);

  // Fetch available profiles
  const { data: profilesData } = useQuery({
    queryKey: ['onboardingProfiles'],
    queryFn: getOnboardingProfiles,
    enabled: isOpen,
  });

  // Analyze mutation
  const analyzeMutation = useMutation({
    mutationFn: () => analyzeForOnboarding(records, targetProfile),
    onSuccess: (data) => {
      setAnalysis(data);
      // Pre-populate field mappings from suggestions
      const mappings: Record<string, string> = {};
      data.suggested_mappings.forEach((s: MappingSuggestion) => {
        if (s.confidence >= 0.7) {
          mappings[s.source_field] = s.target_field;
        }
      });
      setFieldMappings(mappings);
      setStep('map');
    },
  });

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: () => previewOnboarding(records, targetProfile, fieldMappings, {
      sample_size: 5,
      include_enrichment: autoEnrich,
    }),
    onSuccess: (data) => {
      setPreview(data);
      setStep('preview');
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: () => executeOnboarding(records, targetProfile, fieldMappings, {
      auto_enrich: autoEnrich,
      skip_invalid: skipInvalid,
    }),
    onSuccess: (data) => {
      setResult(data);
      setStep('complete');
      onComplete?.(data);
    },
  });

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Handle both array of records and {records: [...]} format
        const data = Array.isArray(json) ? json : json.records || json.data || [];
        setRecords(data);
      } catch {
        showToast({ type: 'error', title: 'Error', message: 'Failed to parse JSON file' });
      }
    };
    reader.readAsText(file);
  }, []);

  // Handle mapping change
  const handleMappingChange = (sourceField: string, targetField: string) => {
    setFieldMappings((prev) => ({
      ...prev,
      [sourceField]: targetField,
    }));
  };

  // Reset and close
  const handleClose = () => {
    setStep('upload');
    setRecords([]);
    setTargetProfile('');
    setFieldMappings({});
    setAnalysis(null);
    setPreview(null);
    setResult(null);
    onClose();
  };

  if (!isOpen) return null;

  const profiles = profilesData?.profiles || [];

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4"
        {...getModalAriaProps(titleId, descriptionId)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <div>
            <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">
              Data Onboarding
            </h2>
            <p id={descriptionId} className="mt-1 mb-0 text-sm text-archive">
              Migrate legacy data into Collections
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-archive hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 bg-parchment border-b border-lichen">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            {(['upload', 'analyze', 'map', 'preview', 'execute', 'complete'] as Step[]).map((s, i) => {
              const stepNumber = i + 1;
              const isCurrent = step === s;
              const isPast = ['upload', 'analyze', 'map', 'preview', 'execute', 'complete'].indexOf(step) > i;
              return (
                <div key={s} className="flex items-center">
                  <div
                    className={`
                      flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium
                      ${isCurrent ? 'bg-bark text-parchment' : isPast ? 'bg-semantic-success text-parchment' : 'bg-stone text-archive'}
                    `}
                  >
                    {isPast ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      stepNumber
                    )}
                  </div>
                  {i < 5 && (
                    <div className={`w-12 h-0.5 mx-1 ${isPast ? 'bg-semantic-success' : 'bg-stone'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Step: Upload */}
          {step === 'upload' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-medium text-ink mb-2">Upload Data</h3>
                <p className="text-sm text-archive mb-4">
                  Upload a JSON file containing records to onboard. Each record should have
                  a <code className="bg-parchment px-1 rounded-sm">properties</code> object with the data fields.
                </p>
                <div className="border-2 border-dashed border-lichen rounded-sm p-8 text-center">
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="cursor-pointer text-bark hover:text-bark/80"
                  >
                    <svg className="mx-auto h-12 w-12 text-archive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="mt-2 block text-sm font-medium">
                      Click to upload or drag and drop
                    </span>
                    <span className="mt-1 block text-xs text-archive">
                      JSON file up to 10MB
                    </span>
                  </label>
                </div>
                {records.length > 0 && (
                  <p className="mt-2 text-sm text-semantic-success">
                    Loaded {records.length} records
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Target Profile
                </label>
                <select
                  value={targetProfile}
                  onChange={(e) => setTargetProfile(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  <option value="">Select a profile...</option>
                  {profiles.map((profile: OnboardingProfile) => (
                    <option key={profile.name} value={profile.name}>
                      {profile.name} ({profile.canonical_type}) - v{profile.version}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Step: Analyze */}
          {step === 'analyze' && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bark mx-auto"></div>
                <p className="mt-4 text-sm text-archive">Analyzing records...</p>
              </div>
            </div>
          )}

          {/* Step: Map */}
          {step === 'map' && analysis && (
            <div className="space-y-6">
              <div className="bg-bark/10 border border-bark/30 rounded-sm p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-ink">Analysis Complete</h4>
                    <p className="text-sm text-archive">
                      {analysis.record_count} records analyzed - Readiness score: {Math.round(analysis.readiness_score)}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-archive">
                      {analysis.valid_count} valid / {analysis.invalid_count} invalid
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-base font-medium text-ink mb-3">Field Mappings</h3>
                <p className="text-sm text-archive mb-4">
                  Map your source fields to the target profile fields. High-confidence suggestions are pre-selected.
                </p>
                <div className="border border-lichen rounded-sm overflow-hidden">
                  <table className="min-w-full divide-y divide-lichen">
                    <thead className="bg-parchment">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-archive uppercase">Source Field</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-archive uppercase">Coverage</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-archive uppercase">Target Field</th>
                      </tr>
                    </thead>
                    <tbody className="bg-parchment divide-y divide-lichen">
                      {analysis.source_fields.map((field) => (
                        <tr key={field.field_name}>
                          <td className="px-4 py-2 text-sm text-ink">{field.field_name}</td>
                          <td className="px-4 py-2 text-sm text-archive">{Math.round(field.coverage_percent)}%</td>
                          <td className="px-4 py-2">
                            <select
                              value={fieldMappings[field.field_name] || ''}
                              onChange={(e) => handleMappingChange(field.field_name, e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-lichen rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                            >
                              <option value="">-- Skip --</option>
                              {[...new Set([
                                ...(analysis.unmapped_target_fields || []),
                                ...Object.values(fieldMappings),
                              ])].filter(Boolean).map((tf) => (
                                <option key={tf} value={tf}>{tf}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center">
                  <Checkbox
                    checked={autoEnrich}
                    onChange={(e) => setAutoEnrich(e.target.checked)}
                  />
                  <span className="ml-2 text-sm text-ink">Enable AI enrichment for missing fields</span>
                </label>
                <label className="flex items-center">
                  <Checkbox
                    checked={skipInvalid}
                    onChange={(e) => setSkipInvalid(e.target.checked)}
                  />
                  <span className="ml-2 text-sm text-ink">Skip invalid records</span>
                </label>
              </div>
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && preview && (
            <div className="space-y-6">
              <div className="bg-semantic-success/10 border border-semantic-success/30 rounded-sm p-4">
                <h4 className="font-medium text-ink">Preview Ready</h4>
                <p className="text-sm text-archive">
                  {preview.would_pass_count} of {preview.record_count} records will pass validation
                  (Success rate: {Math.round(preview.success_rate)}%)
                </p>
              </div>

              <div>
                <h3 className="text-base font-medium text-ink mb-3">Sample Transformed Records</h3>
                <div className="bg-parchment rounded-sm p-4 overflow-x-auto">
                  <pre className="text-xs text-ink">
                    {JSON.stringify(preview.sample_records.slice(0, 3), null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Step: Execute */}
          {step === 'execute' && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bark mx-auto"></div>
                <p className="mt-4 text-sm text-archive">Executing onboarding...</p>
              </div>
            </div>
          )}

          {/* Step: Complete */}
          {step === 'complete' && result && (
            <div className="space-y-6">
              <div className={`rounded-sm p-4 ${result.status === 'completed' ? 'bg-semantic-success/10 border border-semantic-success/30' : 'bg-semantic-warning/10 border border-semantic-warning/30'}`}>
                <h4 className={`font-medium ${result.status === 'completed' ? 'text-ink' : 'text-ink'}`}>
                  Onboarding {result.status === 'completed' ? 'Complete' : result.status}
                </h4>
                <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-archive">Total Records:</span>{' '}
                    <span className="font-medium text-ink">{result.total_records}</span>
                  </div>
                  <div>
                    <span className="text-archive">Successful:</span>{' '}
                    <span className="font-medium text-semantic-success">{result.successful_count}</span>
                  </div>
                  <div>
                    <span className="text-archive">Failed:</span>{' '}
                    <span className="font-medium text-semantic-error">{result.failed_count}</span>
                  </div>
                  <div>
                    <span className="text-archive">Skipped:</span>{' '}
                    <span className="font-medium text-semantic-warning">{result.skipped_count}</span>
                  </div>
                  {result.enriched_count > 0 && (
                    <div>
                      <span className="text-archive">Enriched:</span>{' '}
                      <span className="font-medium text-bark">{result.enriched_count}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-archive">Success Rate:</span>{' '}
                    <span className="font-medium text-ink">{Math.round(result.success_rate)}%</span>
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-ink mb-2">Errors</h4>
                  <div className="bg-semantic-error/10 rounded-sm p-3 max-h-40 overflow-y-auto">
                    {result.errors.map((error, i) => (
                      <p key={i} className="text-xs text-semantic-error">
                        {JSON.stringify(error)}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex items-center justify-between">
          <div>
            {(analyzeMutation.isError || previewMutation.isError || executeMutation.isError) && (
              <span className="text-sm text-semantic-error">
                An error occurred. Please try again.
              </span>
            )}
          </div>
          <div className="flex gap-3">
            {step !== 'complete' && (
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 transition-colors"
              >
                Cancel
              </button>
            )}

            {step === 'upload' && (
              <button
                type="button"
                onClick={() => {
                  setStep('analyze');
                  analyzeMutation.mutate();
                }}
                disabled={records.length === 0 || !targetProfile}
                className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Analyze Records
              </button>
            )}

            {step === 'map' && (
              <button
                type="button"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {previewMutation.isPending ? 'Loading...' : 'Preview Transformation'}
              </button>
            )}

            {step === 'preview' && (
              <button
                type="button"
                onClick={() => {
                  setStep('execute');
                  executeMutation.mutate();
                }}
                disabled={executeMutation.isPending}
                className="px-4 py-2 bg-semantic-success text-parchment rounded-sm text-sm hover:bg-semantic-success/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Execute Onboarding
              </button>
            )}

            {step === 'complete' && (
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
