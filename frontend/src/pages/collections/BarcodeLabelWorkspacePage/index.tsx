import { useState, useEffect, useRef, useCallback } from 'react';
import Checkbox from '../../../components/Checkbox';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDateShort, formatDateTime } from '@/lib/formatters';
import {
  Tag,
  Loader2,
  Printer,
  Trash2,
  XCircle,
  Plus,
  Search,
  RefreshCw,
  Settings,
} from 'lucide-react';
import bwipjs from 'bwip-js/browser';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  SectionGroupDivider,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { apiFetch } from '../../../lib/apiClient';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

import {
  useFormState,
  useLabelActions,
  useSectionState,
  useSectionSummaries,
  useHasContent,
  getEntityId,
  getEntityLabel,
} from './hooks';
import type { BarcodeLabel } from './types';
import {
  BARCODE_SECTION_GROUPS,
  ALL_SECTION_IDS,
  BWIP_BCID,
  LABEL_SIZES,
} from './types';

// =============================================================================
// BarcodeVisual — renders a barcode on canvas
// =============================================================================

function BarcodeVisual({ value, format, publicUrl }: { value: string; format: string; publicUrl?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  const render = useCallback(() => {
    if (!canvasRef.current) return;
    setError(null);
    const bcid = BWIP_BCID[format] || 'code128';
    const isMatrix = bcid === 'qrcode' || bcid === 'datamatrix';
    const text = isMatrix && publicUrl ? publicUrl : value;
    try {
      bwipjs.toCanvas(canvasRef.current, {
        bcid,
        text,
        scale: 3,
        height: isMatrix ? 30 : 12,
        ...(isMatrix ? { width: 30 } : {}),
        includetext: !isMatrix,
        textxalign: 'center',
      });
    } catch (e) {
      setError((e as Error).message || 'Failed to render barcode');
    }
  }, [value, format, publicUrl]);

  useEffect(() => { render(); }, [render]);

  if (error) {
    return (
      <div className="text-sm text-semantic-error bg-semantic-error/5 rounded-lg px-4 py-3 text-center">
        Could not render barcode: {error}
      </div>
    );
  }

  return <canvas ref={canvasRef} className="mx-auto" />;
}

// =============================================================================
// Outer wrapper with SectionOrderProvider
// =============================================================================

export default function BarcodeLabelWorkspacePage() {
  return (
    <SectionOrderProvider>
      <BarcodeLabelWorkspacePageContent />
    </SectionOrderProvider>
  );
}

// =============================================================================
// Main content
// =============================================================================

function BarcodeLabelWorkspacePageContent() {
  const { orgId, labelId } = useParams<{ orgId: string; labelId?: string }>();
  const [searchParams] = useSearchParams();
  const isCreate = !labelId;
  const useNewLayout = searchParams.get('layout') !== 'classic' && !isCreate;

  const [showCreateTask, setShowCreateTask] = useState(false);

  // Fetch existing label (view mode)
  const { data: label, isLoading: labelLoading } = useQuery({
    queryKey: ['barcode-label', orgId, labelId],
    queryFn: () => apiFetch<BarcodeLabel>(`/organizations/${orgId}/collections/barcodes/labels/${labelId}`),
    enabled: !!orgId && !!labelId,
  });

  // Hooks
  const form = useFormState({ orgId, isCreateMode: isCreate });
  const actions = useLabelActions({ orgId, labelId, label });
  const sectionState = useSectionState();
  const sectionSummaries = useSectionSummaries(form.formData, label, isCreate);
  const hasContent = useHasContent(form.formData, label, isCreate);

  const {
    formData,
    updateField,
    saveStatus,
    lastSaved,
    errorMessage,
    handleCreate,
    createMutation,
    enums,
    entitySearchQuery,
    setEntitySearchQuery,
    entityList,
    endpoint,
  } = form;

  const {
    confirmAction,
    setConfirmAction,
    printSize,
    setPrintSize,
    branding,
    printMutation,
    voidMutation,
    deleteMutation,
    regenerateMutation,
    handlePrint,
  } = actions;

  const {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleEnterEditMode,
  } = sectionState;

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    entity: {
      entity_type: isCreate ? formData.entity_type : label?.entity_type,
      entity_id: isCreate ? formData.entity_id : label?.entity_id,
    },
    format: {
      label_format: isCreate ? formData.label_format : label?.label_format,
      barcode_value: isCreate ? formData.barcode_value : label?.barcode_value,
    },
    label: label ? { status: label.status, barcode_value: label.barcode_value } : {},
    actions: label ? { status: label.status } : {},
  };

  // Loading state
  if (!isCreate && labelLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-center py-12">
          <MadronaLoader variant="dots" />
        </div>
      </div>
    );
  }

  // Error state
  if (!isCreate && !labelLoading && !label) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Tag size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Label not found
        </h3>
        <p className="text-accessible-gray mb-4">
          The barcode label could not be loaded.
        </p>
      </div>
    );
  }

  const displayTitle = isCreate ? 'Generate Barcode Label' : 'Barcode Label';
  const displayNumber = !isCreate && label ? label.barcode_value : '';

  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/barcodes/labels`}
          backText="Back to Labels"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isCreate}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={false}
          showCreateButton={isCreate}
          createButtonText="Generate Label"
          onSave={isCreate ? handleCreate : undefined}
        />
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg">
          <p className="text-semantic-error">{errorMessage}</p>
        </div>
      )}

      {/* Read-only indicator — barcode labels are view-only after generation */}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === SETUP GROUP (Create mode) === */}
        {isCreate && (
          <>
            {useNewLayout && <SectionGroupDivider label="Label Setup" icon={Settings} />}

            {/* Entity Selection */}
            <WorkspaceSection
              id="entity"
              title="Entity Selection"
              icon={<Tag size={18} />}
              isExpanded={expandedSections.entity}
              onToggle={() => toggleSection('entity')}
              isEditing={true}
              order={getSectionOrder('entity')}
              isEmpty={!hasContent.entity}
              summary={sectionSummaries.entity}
            >
              <div className="space-y-4">
                {/* Entity Type */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Entity Type</label>
                  <select
                    value={formData.entity_type}
                    onChange={(e) => updateField('entity_type', e.target.value)}
                    className="w-full border border-lichen rounded-lg px-3 py-2 text-sm bg-parchment text-ink"
                  >
                    {enums?.entity_types?.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    )) || (
                      <>
                        <option value="collection_object">Collection Object</option>
                        <option value="object_part">Object Part</option>
                        <option value="location">Location</option>
                        <option value="crate">Crate</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Entity Search */}
                {endpoint && (
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Select {formData.entity_type === 'collection_object' ? 'Object' : 'Location'}
                    </label>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-archive" />
                      <input
                        type="text"
                        value={entitySearchQuery}
                        onChange={(e) => setEntitySearchQuery(e.target.value)}
                        placeholder="Search..."
                        className="w-full pl-9 pr-3 py-2 border border-lichen rounded-lg text-sm bg-parchment text-ink"
                      />
                    </div>
                    <div className="border border-lichen rounded-lg max-h-48 overflow-y-auto divide-y divide-lichen">
                      {entityList.map((entity) => {
                        const id = getEntityId(entity, formData.entity_type);
                        const lbl = getEntityLabel(entity, formData.entity_type);
                        return (
                          <button
                            key={id}
                            onClick={() => updateField('entity_id', id)}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-stone/50 transition-colors ${
                              formData.entity_id === id ? 'bg-azurite/10 text-azurite font-medium' : 'text-ink'
                            }`}
                          >
                            {lbl}
                          </button>
                        );
                      })}
                      {entityList.length === 0 && (
                        <p className="px-3 py-4 text-sm text-archive text-center">No results</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </WorkspaceSection>

            {/* Barcode Format */}
            <WorkspaceSection
              id="format"
              title="Barcode Format"
              icon={<Settings size={18} />}
              isExpanded={expandedSections.format}
              onToggle={() => toggleSection('format')}
              isEditing={true}
              order={getSectionOrder('format')}
              isEmpty={!hasContent.format}
              summary={sectionSummaries.format}
            >
              <div className="space-y-4">
                {/* Barcode Value */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Barcode Value</label>
                  <div className="flex items-center gap-3 mb-2">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <Checkbox
                        checked={formData.auto_generate}
                        onChange={(e) => updateField('auto_generate', e.target.checked)}
                      />
                      Auto-generate
                    </label>
                  </div>
                  {!formData.auto_generate && (
                    <input
                      type="text"
                      value={formData.barcode_value}
                      onChange={(e) => updateField('barcode_value', e.target.value)}
                      placeholder="Enter custom barcode value"
                      className="w-full border border-lichen rounded-lg px-3 py-2 text-sm font-mono bg-parchment text-ink"
                    />
                  )}
                </div>

                {/* Format */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Format</label>
                  <select
                    value={formData.label_format}
                    onChange={(e) => updateField('label_format', e.target.value)}
                    className="w-full border border-lichen rounded-lg px-3 py-2 text-sm bg-parchment text-ink"
                  >
                    {enums?.label_formats?.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    )) || (
                      <>
                        <option value="code128">Code 128</option>
                        <option value="qr">QR Code</option>
                        <option value="datamatrix">Data Matrix</option>
                        <option value="ean13">EAN-13</option>
                        <option value="code39">Code 39</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Note */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Note (optional)</label>
                  <textarea
                    value={formData.note}
                    onChange={(e) => updateField('note', e.target.value)}
                    rows={2}
                    className="w-full border border-lichen rounded-lg px-3 py-2 text-sm bg-parchment text-ink"
                  />
                </div>

                {/* Submit */}
                <div className="flex justify-end">
                  <button
                    onClick={handleCreate}
                    disabled={!formData.entity_id || createMutation.isPending}
                    className="px-4 py-2 bg-bark text-parchment rounded-lg font-medium hover:bg-bark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Generate Label
                  </button>
                </div>
              </div>
            </WorkspaceSection>
          </>
        )}

        {/* === OUTPUT GROUP (View mode) === */}
        {!isCreate && label && (
          <>
            {useNewLayout && <SectionGroupDivider label="Label Output" icon={Printer} />}

            {/* Label Details */}
            <WorkspaceSection
              id="label"
              title="Label Details"
              icon={<Tag size={18} />}
              isExpanded={expandedSections.label}
              onToggle={() => toggleSection('label')}
              isEditing={false}
              order={getSectionOrder('label')}
              isEmpty={!hasContent.label}
              summary={sectionSummaries.label}
            >
              {/* Print-ready label card */}
              <div className="bg-parchment border border-lichen rounded-xl overflow-hidden max-w-md mx-auto shadow-sm">
                <div
                  className="px-5 py-2.5 flex items-center justify-between"
                  style={{ backgroundColor: branding?.primary_color || undefined }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {branding?.logo_url && (
                      <img
                        src={branding.logo_url}
                        alt=""
                        className="h-5 w-auto object-contain flex-shrink-0"
                        crossOrigin="anonymous"
                      />
                    )}
                    <span className="text-xs font-medium tracking-widest uppercase text-parchment/70 truncate">
                      {branding?.letterhead_name || label.entity_type_label}
                    </span>
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 ${
                    label.status === 'active'
                      ? 'bg-parchment/15 text-parchment'
                      : 'bg-semantic-error/20 text-parchment/70'
                  }`}>
                    {label.status_label}
                  </span>
                </div>

                <div className="px-5 pt-4 pb-2 border-b border-lichen/60">
                  <p className="text-xs uppercase tracking-wider text-archive mb-0.5">Accession No.</p>
                  <p className="text-lg font-semibold text-ink tracking-wide">
                    {label.entity_summary?.object_number || label.entity_summary?.name || label.entity_id}
                  </p>
                  {label.entity_summary?.title && (
                    <p className="text-sm text-archive italic mt-0.5 line-clamp-2">
                      {label.entity_summary.title}
                    </p>
                  )}
                </div>

                <div className="px-5 py-5 flex flex-col items-center">
                  <BarcodeVisual value={label.barcode_value} format={label.label_format} publicUrl={label.public_url} />
                  <p className="text-[11px] font-mono text-archive tracking-wider mt-2">
                    {label.label_format_label}
                  </p>
                  {label.public_url && (
                    <p className="text-[10px] text-archive mt-1 flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-semantic-success" />
                      Public gallery link encoded
                    </p>
                  )}
                </div>

                <div className="px-5 py-3 bg-stone/30 border-t border-lichen/60 flex items-center justify-between text-[11px] text-archive">
                  <span>Generated {formatDateShort(label.created_at)}</span>
                  <span className="font-mono">{label.print_count > 0 ? `Printed \u00d7${label.print_count}` : 'Not yet printed'}</span>
                </div>
              </div>

              {/* Metadata (below the label) */}
              <div className="max-w-md mx-auto mt-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm px-1">
                  {label.last_printed_at && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-archive">Last Printed</p>
                      <p className="font-medium text-ink">
                        {formatDateShort(label.last_printed_at)}
                      </p>
                    </div>
                  )}
                  {label.batch_id && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-archive">Batch</p>
                      <p className="font-mono text-xs text-ink">{label.batch_id.slice(0, 8)}</p>
                    </div>
                  )}
                  {label.note && (
                    <div className="col-span-2">
                      <p className="text-xs uppercase tracking-wider text-archive">Note</p>
                      <p className="text-ink">{label.note}</p>
                    </div>
                  )}
                </div>
              </div>
            </WorkspaceSection>

            {/* Actions */}
            <WorkspaceSection
              id="actions"
              title="Actions"
              icon={<Printer size={18} />}
              isExpanded={expandedSections.actions}
              onToggle={() => toggleSection('actions')}
              isEditing={false}
              order={getSectionOrder('actions')}
              isEmpty={false}
              summary={undefined}
            >
              {confirmAction ? (
                <div className="border border-lichen rounded-lg bg-parchment p-4">
                  <p className="text-sm text-ink mb-3">
                    {confirmAction === 'void'
                      ? 'Void this label? It will no longer resolve when scanned.'
                      : 'Permanently delete this label? This cannot be undone.'}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        confirmAction === 'void' ? voidMutation.mutate() : deleteMutation.mutate()
                      }
                      disabled={voidMutation.isPending || deleteMutation.isPending}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium text-parchment disabled:opacity-50 flex items-center gap-1.5 ${
                        confirmAction === 'delete' ? 'bg-semantic-error' : 'bg-semantic-warning'
                      }`}
                    >
                      {(voidMutation.isPending || deleteMutation.isPending) && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {confirmAction === 'void' ? 'Void Label' : 'Delete Label'}
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium text-archive hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  {/* Print controls */}
                  {label.status === 'active' && (
                    <div className="flex items-center gap-2">
                      <select
                        value={printSize.value}
                        onChange={(e) => {
                          const s = LABEL_SIZES.find((l) => l.value === e.target.value);
                          if (s) setPrintSize(s);
                        }}
                        className="border border-lichen rounded-lg px-3 py-2 text-sm bg-parchment text-ink"
                      >
                        {LABEL_SIZES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={handlePrint}
                        disabled={printMutation.isPending}
                        className="px-4 py-2 bg-bark text-parchment rounded-lg font-medium hover:bg-bark/90 disabled:opacity-50 flex items-center gap-2"
                      >
                        {printMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Printer className="h-4 w-4" />
                        )}
                        Print
                      </button>
                    </div>
                  )}

                  {/* Other actions */}
                  <div className="flex justify-center gap-3">
                    {label.status === 'active' ? (
                      <button
                        onClick={() => setConfirmAction('void')}
                        className="px-4 py-2 border border-lichen rounded-lg font-medium text-semantic-warning hover:bg-semantic-warning/5 flex items-center gap-2"
                      >
                        <XCircle className="h-4 w-4" />
                        Void
                      </button>
                    ) : (
                      <button
                        onClick={() => regenerateMutation.mutate()}
                        disabled={regenerateMutation.isPending}
                        className="px-4 py-2 bg-bark text-parchment rounded-lg font-medium hover:bg-bark/90 disabled:opacity-50 flex items-center gap-2"
                      >
                        {regenerateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Regenerate
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmAction('delete')}
                      className="px-4 py-2 border border-lichen rounded-lg font-medium text-semantic-error hover:bg-semantic-error/5 flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </WorkspaceSection>
          </>
        )}
      </div>

      {/* Footer metadata - view mode only */}
      {!isCreate && label && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(label.created_at)}</p>
          {label.updated_at && (
            <p>Last updated: {formatDateTime(label.updated_at)}</p>
          )}
        </div>
      )}

      {/* CreateTaskSlideOver */}
      {orgId && labelId && label && (
        <CreateTaskSlideOver
          isOpen={showCreateTask}
          onClose={() => setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={'barcode_label' as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={labelId}
          initialEntityLabel={label.barcode_value || `Label ${labelId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper (view mode only)
  if (useNewLayout && label) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/barcodes/labels`}
        backLabel="Back to Labels"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={BARCODE_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: false,
            canDelete: true,
          }}
          callbacks={{
            onDelete: () => setConfirmAction('delete'),
            onCreateTask: () => setShowCreateTask(true),
          }}
          isEditing={false}
          onSectionNavigate={handleEnterEditMode}
          pageType="barcode-label"
          enabled={true}
          showHeader={true}
          title="Barcode Label"
          objectNumber={label.barcode_value}
          subtitle={label.entity_summary?.object_number || label.entity_summary?.name || undefined}
          backUrl={`/organizations/${orgId}/collections/barcodes/labels`}
          backLabel="Back to Labels"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/barcodes/labels` : undefined}
      backLabel="Back to Labels"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
