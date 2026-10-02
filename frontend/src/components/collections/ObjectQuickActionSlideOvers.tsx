/**
 * Quick Action SlideOvers for Object Detail Page
 *
 * These provide streamlined creation forms for common actions directly from the object page.
 * Users can fill in essential fields and create records quickly, then edit details later.
 */

import { useState, useEffect } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  DollarSign,
  Calendar,
  FileText,
  Loader2,
} from 'lucide-react';
import { SlideOver } from '../ui/SlideOver';
import {
  createConditionReport,
  createIncidentReport,
  createConservationTreatment,
  createValuation,
  createLoanOut,
  createUseRequest,
  addLoanOutObject,
  addIncidentObject,
} from '../../lib/api';

// ============================================================================
// SHARED TYPES
// ============================================================================

interface BaseSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  objectId: string;
  objectNumber?: string;
  objectTitle?: string;
  onSuccess?: () => void;
}

// ============================================================================
// CONDITION REPORT SLIDEOVER
// ============================================================================

const CONDITION_TYPES = [
  { value: 'routine', label: 'Routine' },
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'loan_out', label: 'Loan Out' },
  { value: 'loan_return', label: 'Loan Return' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'damage', label: 'Damage' },
  { value: 'exhibition', label: 'Exhibition' },
];

const OVERALL_CONDITIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'unacceptable', label: 'Unacceptable' },
];

export function ConditionReportSlideOver({
  isOpen,
  onClose,
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  onSuccess,
}: BaseSlideOverProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    report_type: 'routine',
    overall_condition: '',
    report_date: new Date().toISOString().split('T')[0],
    condition_summary: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        report_type: 'routine',
        overall_condition: '',
        report_date: new Date().toISOString().split('T')[0],
        condition_summary: '',
      });
      setError(null);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createConditionReport(organizationId, data),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['condition-reports'] });
      queryClient.invalidateQueries({ queryKey: ['object-procedures', organizationId, objectId] });
      onSuccess?.();
      onClose();
      navigate(`/organizations/${organizationId}/collections/condition-reports/${report.report_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create condition report');
    },
  });

  const handleSubmit = () => {
    if (!formData.overall_condition) {
      setError('Please select an overall condition');
      return;
    }

    createMutation.mutate({
      object_id: objectId,
      report_type: formData.report_type,
      overall_condition: formData.overall_condition,
      report_date: formData.report_date,
      condition_summary: formData.condition_summary || undefined,
      status: 'draft',
    });
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="New Condition Report"
      subtitle={objectNumber ? `${objectNumber}${objectTitle ? `: ${objectTitle}` : ''}` : undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink" disabled={createMutation.isPending}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
            disabled={createMutation.isPending || !formData.overall_condition}
          >
            {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" />Creating...</> : 'Create Report'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              Report Type <span className="text-semantic-error">*</span>
            </label>
            <select
              value={formData.report_type}
              onChange={(e) => setFormData(prev => ({ ...prev, report_type: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {CONDITION_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              <Calendar size={14} className="inline mr-1.5" />
              Report Date
            </label>
            <input
              type="date"
              value={formData.report_date}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setFormData(prev => ({ ...prev, report_date: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Overall Condition <span className="text-semantic-error">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {OVERALL_CONDITIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, overall_condition: opt.value }))}
                className={`px-3 py-2.5 text-sm rounded-lg border transition-colors text-center ${
                  formData.overall_condition === opt.value
                    ? 'bg-bark text-parchment border-bark'
                    : 'bg-parchment text-ink border-lichen hover:border-bark/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            <FileText size={14} className="inline mr-1.5" />
            Condition Summary
          </label>
          <textarea
            value={formData.condition_summary}
            onChange={(e) => setFormData(prev => ({ ...prev, condition_summary: e.target.value }))}
            placeholder="Brief description of the object's current condition..."
            rows={4}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ============================================================================
// INCIDENT REPORT SLIDEOVER
// ============================================================================

const INCIDENT_TYPES = [
  { value: 'damage', label: 'Damage' },
  { value: 'loss', label: 'Loss' },
  { value: 'theft', label: 'Theft' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'security', label: 'Security Breach' },
  { value: 'handling', label: 'Handling Incident' },
  { value: 'other', label: 'Other' },
];

export function IncidentReportSlideOver({
  isOpen,
  onClose,
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  onSuccess,
}: BaseSlideOverProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    incident_type: 'damage',
    incident_date: new Date().toISOString().split('T')[0],
    description: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        incident_type: 'damage',
        incident_date: new Date().toISOString().split('T')[0],
        description: '',
      });
      setError(null);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const report = await createIncidentReport(organizationId, data);
      // Link the object to the incident
      await addIncidentObject(organizationId, report.report_id, {
        object_id: objectId,
      });
      return report;
    },
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['object-procedures', organizationId, objectId] });
      onSuccess?.();
      onClose();
      navigate(`/organizations/${organizationId}/collections/incidents/${report.report_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create incident report');
    },
  });

  const handleSubmit = () => {
    if (!formData.description.trim()) {
      setError('Please provide a description of the incident');
      return;
    }

    createMutation.mutate({
      incident_type: formData.incident_type,
      incident_date: formData.incident_date,
      description: formData.description,
      status: 'reported',
    });
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Report Incident"
      subtitle={objectNumber ? `${objectNumber}${objectTitle ? `: ${objectTitle}` : ''}` : undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink" disabled={createMutation.isPending}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-semantic-error text-parchment rounded-lg hover:bg-semantic-error/90 disabled:opacity-50 flex items-center gap-2"
            disabled={createMutation.isPending || !formData.description.trim()}
          >
            {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" />Reporting...</> : 'Report Incident'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
            {error}
          </div>
        )}

        <div className="p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-semantic-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-semantic-warning">
              Report any damage, loss, theft, or security incidents immediately. This creates a formal record for investigation.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              Incident Type <span className="text-semantic-error">*</span>
            </label>
            <select
              value={formData.incident_type}
              onChange={(e) => setFormData(prev => ({ ...prev, incident_type: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {INCIDENT_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              <Calendar size={14} className="inline mr-1.5" />
              Incident Date
            </label>
            <input
              type="date"
              value={formData.incident_date}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setFormData(prev => ({ ...prev, incident_date: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Description <span className="text-semantic-error">*</span>
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Describe what happened, when it was discovered, and any immediate actions taken..."
            rows={5}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ============================================================================
// CONSERVATION TREATMENT SLIDEOVER
// ============================================================================

const TREATMENT_TYPES = [
  { value: 'examination', label: 'Examination' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'stabilization', label: 'Stabilization' },
  { value: 'repair', label: 'Repair' },
  { value: 'restoration', label: 'Restoration' },
  { value: 'preventive', label: 'Preventive' },
  { value: 'rehousing', label: 'Rehousing' },
];

const TREATMENT_PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function ConservationSlideOver({
  isOpen,
  onClose,
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  onSuccess,
}: BaseSlideOverProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    treatment_type: 'examination',
    priority: 'medium',
    proposed_treatment: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        treatment_type: 'examination',
        priority: 'medium',
        proposed_treatment: '',
      });
      setError(null);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createConservationTreatment(organizationId, data),
    onSuccess: (treatment) => {
      queryClient.invalidateQueries({ queryKey: ['conservation'] });
      queryClient.invalidateQueries({ queryKey: ['object-procedures', organizationId, objectId] });
      onSuccess?.();
      onClose();
      navigate(`/organizations/${organizationId}/collections/conservation/${treatment.treatment_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create conservation treatment');
    },
  });

  const handleSubmit = () => {
    createMutation.mutate({
      object_id: objectId,
      treatment_type: formData.treatment_type,
      priority: formData.priority,
      proposed_treatment: formData.proposed_treatment || undefined,
      status: 'proposed',
    });
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="New Conservation Treatment"
      subtitle={objectNumber ? `${objectNumber}${objectTitle ? `: ${objectTitle}` : ''}` : undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink" disabled={createMutation.isPending}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" />Creating...</> : 'Create Treatment'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              Treatment Type <span className="text-semantic-error">*</span>
            </label>
            <select
              value={formData.treatment_type}
              onChange={(e) => setFormData(prev => ({ ...prev, treatment_type: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {TREATMENT_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              Priority <span className="text-semantic-error">*</span>
            </label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {TREATMENT_PRIORITIES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            <FileText size={14} className="inline mr-1.5" />
            Proposed Treatment
          </label>
          <textarea
            value={formData.proposed_treatment}
            onChange={(e) => setFormData(prev => ({ ...prev, proposed_treatment: e.target.value }))}
            placeholder="Describe the proposed conservation treatment..."
            rows={4}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ============================================================================
// VALUATION SLIDEOVER
// ============================================================================

const VALUATION_TYPES = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'market', label: 'Market Value' },
  { value: 'replacement', label: 'Replacement' },
  { value: 'fair_market', label: 'Fair Market' },
  { value: 'donation', label: 'Donation' },
  { value: 'estate', label: 'Estate' },
];

const CURRENCIES = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'CAD', label: 'CAD ($)' },
];

export function ValuationSlideOver({
  isOpen,
  onClose,
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  onSuccess,
}: BaseSlideOverProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    valuation_type: 'insurance',
    valuation_amount: '',
    valuation_currency: 'USD',
    valuation_date: new Date().toISOString().split('T')[0],
    is_current: true,
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        valuation_type: 'insurance',
        valuation_amount: '',
        valuation_currency: 'USD',
        valuation_date: new Date().toISOString().split('T')[0],
        is_current: true,
        notes: '',
      });
      setError(null);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createValuation(organizationId, data),
    onSuccess: (valuation) => {
      queryClient.invalidateQueries({ queryKey: ['valuations'] });
      queryClient.invalidateQueries({ queryKey: ['object-valuations', organizationId, objectId] });
      onSuccess?.();
      onClose();
      navigate(`/organizations/${organizationId}/collections/valuations/${valuation.valuation_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create valuation');
    },
  });

  const handleSubmit = () => {
    const amount = parseFloat(formData.valuation_amount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    createMutation.mutate({
      object_id: objectId,
      valuation_type: formData.valuation_type,
      valuation_amount: amount,
      valuation_currency: formData.valuation_currency,
      valuation_date: formData.valuation_date,
      is_current: formData.is_current,
      notes: formData.notes || undefined,
    });
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="New Valuation"
      subtitle={objectNumber ? `${objectNumber}${objectTitle ? `: ${objectTitle}` : ''}` : undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink" disabled={createMutation.isPending}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
            disabled={createMutation.isPending || !formData.valuation_amount}
          >
            {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" />Creating...</> : 'Create Valuation'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              Valuation Type <span className="text-semantic-error">*</span>
            </label>
            <select
              value={formData.valuation_type}
              onChange={(e) => setFormData(prev => ({ ...prev, valuation_type: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {VALUATION_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              <Calendar size={14} className="inline mr-1.5" />
              Valuation Date
            </label>
            <input
              type="date"
              value={formData.valuation_date}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setFormData(prev => ({ ...prev, valuation_date: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="text-sm font-medium text-ink block mb-1.5">
              <DollarSign size={14} className="inline mr-1.5" />
              Amount <span className="text-semantic-error">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.valuation_amount}
              onChange={(e) => setFormData(prev => ({ ...prev, valuation_amount: e.target.value }))}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">Currency</label>
            <select
              value={formData.valuation_currency}
              onChange={(e) => setFormData(prev => ({ ...prev, valuation_currency: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {CURRENCIES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="is_current"
            checked={formData.is_current}
            onChange={(e) => setFormData(prev => ({ ...prev, is_current: e.target.checked }))}
          />
          <label htmlFor="is_current" className="text-sm text-ink">
            Set as current valuation
          </label>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            <FileText size={14} className="inline mr-1.5" />
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Valuation methodology, appraiser, or other notes..."
            rows={3}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ============================================================================
// LOAN REQUEST SLIDEOVER
// ============================================================================

export function LoanRequestSlideOver({
  isOpen,
  onClose,
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  onSuccess,
}: BaseSlideOverProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    borrower_name: '',
    loan_purpose: '',
    requested_start_date: '',
    requested_end_date: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        borrower_name: '',
        loan_purpose: '',
        requested_start_date: '',
        requested_end_date: '',
        notes: '',
      });
      setError(null);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const loan = await createLoanOut(organizationId, data);
      // Link the object to the loan
      await addLoanOutObject(organizationId, loan.loan_out_id, {
        object_id: objectId,
      });
      return loan;
    },
    onSuccess: (loan) => {
      queryClient.invalidateQueries({ queryKey: ['loans-out'] });
      queryClient.invalidateQueries({ queryKey: ['object-procedures', organizationId, objectId] });
      onSuccess?.();
      onClose();
      navigate(`/organizations/${organizationId}/collections/loans-out/${loan.loan_out_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create loan request');
    },
  });

  const handleSubmit = () => {
    if (!formData.borrower_name.trim()) {
      setError('Please enter the borrower name');
      return;
    }

    createMutation.mutate({
      borrower_name: formData.borrower_name,
      loan_purpose: formData.loan_purpose || undefined,
      loan_start_date: formData.requested_start_date || undefined,
      loan_end_date: formData.requested_end_date || undefined,
      internal_notes: formData.notes || undefined,
      status: 'requested',
    });
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="New Loan Request"
      subtitle={objectNumber ? `${objectNumber}${objectTitle ? `: ${objectTitle}` : ''}` : undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink" disabled={createMutation.isPending}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
            disabled={createMutation.isPending || !formData.borrower_name.trim()}
          >
            {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" />Creating...</> : 'Create Request'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Borrower <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={formData.borrower_name}
            onChange={(e) => setFormData(prev => ({ ...prev, borrower_name: e.target.value }))}
            placeholder="Institution or individual requesting the loan"
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Purpose
          </label>
          <input
            type="text"
            value={formData.loan_purpose}
            onChange={(e) => setFormData(prev => ({ ...prev, loan_purpose: e.target.value }))}
            placeholder="Exhibition, research, etc."
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              <Calendar size={14} className="inline mr-1.5" />
              Requested Start
            </label>
            <input
              type="date"
              value={formData.requested_start_date}
              onChange={(e) => setFormData(prev => ({ ...prev, requested_start_date: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              <Calendar size={14} className="inline mr-1.5" />
              Requested End
            </label>
            <input
              type="date"
              value={formData.requested_end_date}
              min={formData.requested_start_date}
              onChange={(e) => setFormData(prev => ({ ...prev, requested_end_date: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            <FileText size={14} className="inline mr-1.5" />
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Additional details about the loan request..."
            rows={3}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ============================================================================
// USE REQUEST SLIDEOVER
// ============================================================================

const USE_TYPES = [
  { value: 'photography', label: 'Photography' },
  { value: 'research', label: 'Research' },
  { value: 'publication', label: 'Publication' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'commercial', label: 'Commercial Use' },
  { value: 'educational', label: 'Educational' },
  { value: 'media', label: 'Media/Press' },
  { value: 'other', label: 'Other' },
];

export function UseRequestSlideOver({
  isOpen,
  onClose,
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  onSuccess,
}: BaseSlideOverProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    use_type: 'photography',
    requester_name: '',
    requester_institution: '',
    use_description: '',
    requested_date: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        use_type: 'photography',
        requester_name: '',
        requester_institution: '',
        use_description: '',
        requested_date: '',
      });
      setError(null);
    }
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createUseRequest(organizationId, data),
    onSuccess: (request) => {
      queryClient.invalidateQueries({ queryKey: ['use-requests'] });
      queryClient.invalidateQueries({ queryKey: ['object-procedures', organizationId, objectId] });
      onSuccess?.();
      onClose();
      navigate(`/organizations/${organizationId}/collections/use-requests/${request.request_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create use request');
    },
  });

  const handleSubmit = () => {
    if (!formData.requester_name.trim()) {
      setError('Please enter the requester name');
      return;
    }

    createMutation.mutate({
      object_id: objectId,
      use_type: formData.use_type,
      requester_name: formData.requester_name,
      requester_institution: formData.requester_institution || undefined,
      use_description: formData.use_description || undefined,
      requested_date: formData.requested_date || undefined,
      status: 'pending',
    });
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="New Use Request"
      subtitle={objectNumber ? `${objectNumber}${objectTitle ? `: ${objectTitle}` : ''}` : undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink" disabled={createMutation.isPending}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
            disabled={createMutation.isPending || !formData.requester_name.trim()}
          >
            {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" />Creating...</> : 'Create Request'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              Use Type <span className="text-semantic-error">*</span>
            </label>
            <select
              value={formData.use_type}
              onChange={(e) => setFormData(prev => ({ ...prev, use_type: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {USE_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">
              <Calendar size={14} className="inline mr-1.5" />
              Requested Date
            </label>
            <input
              type="date"
              value={formData.requested_date}
              onChange={(e) => setFormData(prev => ({ ...prev, requested_date: e.target.value }))}
              className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Requester Name <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={formData.requester_name}
            onChange={(e) => setFormData(prev => ({ ...prev, requester_name: e.target.value }))}
            placeholder="Name of person making the request"
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Institution
          </label>
          <input
            type="text"
            value={formData.requester_institution}
            onChange={(e) => setFormData(prev => ({ ...prev, requester_institution: e.target.value }))}
            placeholder="Organization or institution (if applicable)"
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            <FileText size={14} className="inline mr-1.5" />
            Description
          </label>
          <textarea
            value={formData.use_description}
            onChange={(e) => setFormData(prev => ({ ...prev, use_description: e.target.value }))}
            placeholder="Describe how the object will be used..."
            rows={3}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}
