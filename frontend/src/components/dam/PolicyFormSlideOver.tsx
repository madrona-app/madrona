import { useState, useEffect, useCallback } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { SlideOver } from '../ui/SlideOver';
import { useToast } from '../../contexts/ToastContext';
import {
  createPreservationPolicy,
  updatePreservationPolicy,
} from '../../lib/api/preservation';
import type {
  PreservationPolicy,
  CreatePolicyPayload,
  UpdatePolicyPayload,
} from '../../lib/api/preservation';

type PolicyType = PreservationPolicy['policy_type'];

interface PolicyFormSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  policy?: PreservationPolicy | null;
}

const POLICY_TYPE_OPTIONS: { value: PolicyType; label: string }[] = [
  { value: 'retention', label: 'Retention' },
  { value: 'format_migration', label: 'Format Migration' },
  { value: 'normalization', label: 'Normalization' },
  { value: 'fixity_schedule', label: 'Fixity Schedule' },
];

type ScopeTarget = 'all' | 'media_type' | 'pronom_puid';

function getScopeTarget(scope: Record<string, unknown>): ScopeTarget {
  if (scope.media_type) return 'media_type';
  if (scope.pronom_puid) return 'pronom_puid';
  return 'all';
}

function getScopeValue(scope: Record<string, unknown>): string {
  return (scope.media_type as string) || (scope.pronom_puid as string) || '';
}

export function PolicyFormSlideOver({
  isOpen,
  onClose,
  organizationId,
  policy,
}: PolicyFormSlideOverProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isEdit = !!policy;

  // Form state
  const [name, setName] = useState('');
  const [policyType, setPolicyType] = useState<PolicyType>('retention');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(0);
  const [isActive, setIsActive] = useState(true);

  // Scope
  const [scopeTarget, setScopeTarget] = useState<ScopeTarget>('all');
  const [scopeValue, setScopeValue] = useState('');

  // Retention rules
  const [retainYears, setRetainYears] = useState(7);
  const [retentionAction, setRetentionAction] = useState<'review' | 'delete'>('review');
  const [notifyDaysBefore, setNotifyDaysBefore] = useState(90);

  // Format migration rules
  const [sourcePuid, setSourcePuid] = useState('');
  const [targetPuid, setTargetPuid] = useState('');
  const [autoMigrate, setAutoMigrate] = useState(false);

  // Normalization rules
  const [normTargetPuid, setNormTargetPuid] = useState('');
  const [onIngest, setOnIngest] = useState(false);
  const [preserveOriginal, setPreserveOriginal] = useState(true);

  // Reset form when opening
  useEffect(() => {
    if (!isOpen) return;

    if (policy) {
      setName(policy.name);
      setPolicyType(policy.policy_type);
      setDescription(policy.description || '');
      setPriority(policy.priority);
      setIsActive(policy.is_active);

      // Scope
      setScopeTarget(getScopeTarget(policy.scope));
      setScopeValue(getScopeValue(policy.scope));

      // Rules
      const r = policy.rules;
      if (policy.policy_type === 'retention') {
        setRetainYears((r.retain_years as number) || 7);
        setRetentionAction((r.action as 'review' | 'delete') || 'review');
        setNotifyDaysBefore((r.notify_days_before as number) || 90);
      } else if (policy.policy_type === 'format_migration') {
        setSourcePuid((r.source_puid as string) || '');
        setTargetPuid((r.target_puid as string) || '');
        setAutoMigrate(!!(r.auto_migrate));
      } else if (policy.policy_type === 'normalization') {
        setNormTargetPuid((r.target_puid as string) || '');
        setOnIngest(!!(r.on_ingest));
        setPreserveOriginal(r.preserve_original !== false);
      }
    } else {
      setName('');
      setPolicyType('retention');
      setDescription('');
      setPriority(0);
      setIsActive(true);
      setScopeTarget('all');
      setScopeValue('');
      setRetainYears(7);
      setRetentionAction('review');
      setNotifyDaysBefore(90);
      setSourcePuid('');
      setTargetPuid('');
      setAutoMigrate(false);
      setNormTargetPuid('');
      setOnIngest(false);
      setPreserveOriginal(true);
    }
  }, [isOpen, policy]);

  const buildScope = useCallback((): Record<string, unknown> => {
    if (scopeTarget === 'media_type') return { media_type: scopeValue };
    if (scopeTarget === 'pronom_puid') return { pronom_puid: scopeValue };
    return {};
  }, [scopeTarget, scopeValue]);

  const buildRules = useCallback((): Record<string, unknown> => {
    switch (policyType) {
      case 'retention':
        return { retain_years: retainYears, action: retentionAction, notify_days_before: notifyDaysBefore };
      case 'format_migration':
        return { source_puid: sourcePuid, target_puid: targetPuid, auto_migrate: autoMigrate };
      case 'normalization':
        return { target_puid: normTargetPuid, on_ingest: onIngest, preserve_original: preserveOriginal };
      case 'fixity_schedule':
        return {};
      default:
        return {};
    }
  }, [policyType, retainYears, retentionAction, notifyDaysBefore, sourcePuid, targetPuid, autoMigrate, normTargetPuid, onIngest, preserveOriginal]);

  const createMutation = useMutation({
    mutationFn: (data: CreatePolicyPayload) => createPreservationPolicy(organizationId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preservation-policies', organizationId] });
      showToast({ type: 'success', title: 'Policy created' });
      onClose();
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to create policy' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdatePolicyPayload) => updatePreservationPolicy(organizationId, policy!.policy_id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preservation-policies', organizationId] });
      showToast({ type: 'success', title: 'Policy updated' });
      onClose();
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to update policy' });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const isValid = name.trim().length > 0 && (
    scopeTarget === 'all' || scopeValue.trim().length > 0
  );

  const handleSubmit = useCallback(() => {
    const scope = buildScope();
    const rules = buildRules();

    if (isEdit) {
      updateMutation.mutate({ name, description: description || null, scope, rules, is_active: isActive, priority });
    } else {
      createMutation.mutate({ name, policy_type: policyType, description: description || null, scope, rules, is_active: isActive, priority });
    }
  }, [isEdit, name, policyType, description, priority, isActive, buildScope, buildRules, createMutation, updateMutation]);

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Policy' : 'New Preservation Policy'}
      subtitle={isEdit ? policy!.name : 'Define a new preservation policy'}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || isPending}
            className="btn-primary px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending && <Loader2 size={16} className="animate-spin" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            placeholder="e.g. 7-Year Retention Policy"
          />
        </div>

        {/* Policy Type */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Policy Type *</label>
          <select
            value={policyType}
            onChange={(e) => setPolicyType(e.target.value as PolicyType)}
            disabled={isEdit}
            className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {POLICY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {isEdit && <p className="text-xs text-archive mt-1">Policy type cannot be changed after creation.</p>}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink resize-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            placeholder="Describe the purpose of this policy..."
          />
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Priority</label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
            className="w-24 px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
          <p className="text-xs text-archive mt-1">Higher values are evaluated first.</p>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive(!isActive)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              isActive ? 'bg-bark' : 'bg-stone'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-parchment shadow transition-transform ${
                isActive ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-sm text-ink">Active</span>
        </div>

        {/* Divider */}
        <div className="border-t border-lichen" />

        {/* Type-specific rules */}
        <div>
          <h3 className="text-sm font-semibold text-ink mb-3">Rules</h3>

          {policyType === 'retention' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-archive mb-1">Retain for (years)</label>
                <input
                  type="number"
                  min={1}
                  value={retainYears}
                  onChange={(e) => setRetainYears(parseInt(e.target.value, 10) || 1)}
                  className="w-24 px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-archive mb-1">Action after expiry</label>
                <select
                  value={retentionAction}
                  onChange={(e) => setRetentionAction(e.target.value as 'review' | 'delete')}
                  className="w-48 px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <option value="review">Review</option>
                  <option value="delete">Delete</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-archive mb-1">Notify days before expiry</label>
                <input
                  type="number"
                  min={0}
                  value={notifyDaysBefore}
                  onChange={(e) => setNotifyDaysBefore(parseInt(e.target.value, 10) || 0)}
                  className="w-24 px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
            </div>
          )}

          {policyType === 'format_migration' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-archive mb-1">Source PRONOM PUID</label>
                <input
                  type="text"
                  value={sourcePuid}
                  onChange={(e) => setSourcePuid(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink font-mono focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g. fmt/44"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-archive mb-1">Target PRONOM PUID</label>
                <input
                  type="text"
                  value={targetPuid}
                  onChange={(e) => setTargetPuid(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink font-mono focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g. fmt/276"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-migrate"
                  checked={autoMigrate}
                  onChange={(e) => setAutoMigrate(e.target.checked)}
                />
                <label htmlFor="auto-migrate" className="text-sm text-ink">Auto-migrate when detected</label>
              </div>
            </div>
          )}

          {policyType === 'normalization' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-archive mb-1">Target PRONOM PUID</label>
                <input
                  type="text"
                  value={normTargetPuid}
                  onChange={(e) => setNormTargetPuid(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink font-mono focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g. fmt/353"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="on-ingest"
                  checked={onIngest}
                  onChange={(e) => setOnIngest(e.target.checked)}
                />
                <label htmlFor="on-ingest" className="text-sm text-ink">Normalize on ingest</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="preserve-original"
                  checked={preserveOriginal}
                  onChange={(e) => setPreserveOriginal(e.target.checked)}
                />
                <label htmlFor="preserve-original" className="text-sm text-ink">Preserve original file</label>
              </div>
            </div>
          )}

          {policyType === 'fixity_schedule' && (
            <p className="text-sm text-archive italic">
              Fixity scheduling rules are applied at the infrastructure level.
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-lichen" />

        {/* Scope */}
        <div>
          <h3 className="text-sm font-semibold text-ink mb-3">Scope</h3>
          <div className="space-y-3">
            <select
              value={scopeTarget}
              onChange={(e) => {
                setScopeTarget(e.target.value as ScopeTarget);
                setScopeValue('');
              }}
              className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="all">All Media</option>
              <option value="media_type">By Media Type</option>
              <option value="pronom_puid">By PRONOM PUID</option>
            </select>
            {scopeTarget !== 'all' && (
              <input
                type="text"
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-lichen rounded-institutional bg-parchment text-ink font-mono focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                placeholder={scopeTarget === 'media_type' ? 'e.g. image/tiff' : 'e.g. fmt/353'}
              />
            )}
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

export default PolicyFormSlideOver;
