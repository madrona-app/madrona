/**
 * Guide QR entry kit: museum-level site QR + printable object-label QR sheets.
 *
 * Section 1 gives an org a single "front-door" QR that opens their public
 * collection site (with the visitor guide). Section 2 lets them pick
 * discoverable objects and print a batch of per-object label QRs.
 */

import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileText, ImageOff, QrCode, Search } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { searchCollections } from '../../lib/api/collections';
import {
  generateLabelPdf,
  getSiteQr,
  MAX_LABELS_PER_BATCH,
  type LabelLayout,
  type QrImageFormat,
} from '../../lib/api/qr';

const PAGE_SIZE = 20;

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function GuideQrKitPage() {
  const { activeOrganizationId, activeOrganization } = useOrganization();
  const orgId = activeOrganizationId ?? '';
  const orgSlug = activeOrganization?.organization_slug ?? 'your-museum';

  // ── Section 1: museum site QR ────────────────────────────────────────
  const siteQrQuery = useQuery({
    queryKey: ['guide-site-qr', orgId],
    queryFn: () => getSiteQr(orgId, 'png'),
    enabled: !!orgId,
  });

  const previewUrl = useMemo(
    () => (siteQrQuery.data ? URL.createObjectURL(siteQrQuery.data) : null),
    [siteQrQuery.data],
  );
  // Revoke the previous object URL once it's no longer rendered.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const downloadSiteMutation = useMutation({
    mutationFn: (format: QrImageFormat) => getSiteQr(orgId, format),
    onSuccess: (blob, format) => {
      triggerBlobDownload(blob, `${orgSlug}-guide-qr.${format}`);
    },
  });

  // ── Section 2: object label QRs ──────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<LabelLayout>('4up');

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const objectsQuery = useQuery({
    queryKey: ['guide-qr-objects', orgId, query, page],
    queryFn: () =>
      searchCollections(orgId, {
        query: query ? { q: query } : undefined,
        filters: { is_discoverable: true },
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        include_facets: false,
      }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const hits = objectsQuery.data?.hits ?? [];
  const total = objectsQuery.data?.total ?? 0;
  const atCap = selectedIds.size >= MAX_LABELS_PER_BATCH;

  const pageIds = useMemo(
    () => (objectsQuery.data?.hits ?? []).map((h) => h.object_id),
    [objectsQuery.data],
  );
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  function toggleOne(objectId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(objectId)) {
        next.delete(objectId);
      } else if (next.size < MAX_LABELS_PER_BATCH) {
        next.add(objectId);
      }
      return next;
    });
  }

  function togglePage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        for (const id of pageIds) {
          if (next.size >= MAX_LABELS_PER_BATCH) break;
          next.add(id);
        }
      }
      return next;
    });
  }

  const generatePdfMutation = useMutation({
    mutationFn: () => generateLabelPdf(orgId, Array.from(selectedIds), layout),
    onSuccess: (blob) => {
      triggerBlobDownload(blob, 'qr-labels.pdf');
    },
  });

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">QR Codes</h1>
        <p className="text-sm text-archive mt-1">
          Printable QR codes that bring visitors from the gallery floor to your
          collection site and its visitor guide.
        </p>
      </div>

      {/* ── Section 1: Museum QR ─────────────────────────────────────── */}
      <section className="border border-lichen rounded-lg p-6 bg-parchment mb-6">
        <div className="flex items-center gap-2 mb-3">
          <QrCode className="w-5 h-5 text-bark" />
          <h2 className="font-semibold text-ink">Museum QR</h2>
        </div>
        <p className="text-sm text-archive mb-4">
          One code for your whole museum. Print it for entrances, wall panels,
          or brochures — scanning it opens your public collection site with the
          visitor guide ready to answer questions.
        </p>

        <div className="flex flex-col sm:flex-row items-start gap-6">
          <div className="w-40 h-40 flex-shrink-0 rounded-md border border-lichen bg-parchment-warm flex items-center justify-center overflow-hidden">
            {siteQrQuery.isLoading ? (
              <span className="text-xs text-archive">Loading…</span>
            ) : siteQrQuery.isError ? (
              <span className="text-xs text-semantic-error px-2 text-center">
                Could not load QR
              </span>
            ) : previewUrl ? (
              <img src={previewUrl} alt="Museum site QR code" className="w-full h-full object-contain p-2" />
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm text-accessible-gray">
              Download and add it to signage. The code never changes, so printed
              copies keep working.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => downloadSiteMutation.mutate('png')}
                disabled={!orgId || downloadSiteMutation.isPending}
                className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Download PNG
              </button>
              <button
                type="button"
                onClick={() => downloadSiteMutation.mutate('svg')}
                disabled={!orgId || downloadSiteMutation.isPending}
                className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Download SVG
              </button>
            </div>
            {downloadSiteMutation.isError && (
              <span className="text-sm text-semantic-error">Download failed — try again.</span>
            )}
          </div>
        </div>
      </section>

      {/* ── Section 2: Object label QRs ──────────────────────────────── */}
      <section className="border border-lichen rounded-lg p-6 bg-parchment">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-5 h-5 text-bark" />
          <h2 className="font-semibold text-ink">Object label QRs</h2>
        </div>
        <p className="text-sm text-archive mb-4">
          Pick discoverable objects and print a sheet of per-object QR labels.
          Each label links to that object's page on your public site.
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="w-4 h-4 text-archive absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search discoverable objects by title or number…"
            aria-label="Search discoverable objects"
            className="w-full rounded-md border border-lichen bg-parchment-warm pl-9 pr-3 py-2 text-sm text-ink placeholder:text-archive focus-visible:ring-2 ring-bark/30 ring-offset-2 focus:outline-none"
          />
        </div>

        {/* Selection summary + cap note */}
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm text-accessible-gray">
            {selectedIds.size} selected
            {selectedIds.size > 0 ? ` of ${MAX_LABELS_PER_BATCH} max` : ''}
          </p>
          {hits.length > 0 && (
            <button
              type="button"
              onClick={togglePage}
              className="text-sm text-bark hover:text-copper-dark focus-visible:ring-2 ring-bark/30 ring-offset-2 rounded"
            >
              {allPageSelected ? 'Deselect page' : 'Select all on page'}
            </button>
          )}
        </div>
        {atCap && (
          <p className="text-xs text-semantic-warning mb-2">
            You've reached the {MAX_LABELS_PER_BATCH}-object limit for one sheet.
            Deselect some to choose others, or generate this batch and print another.
          </p>
        )}

        {/* Object list */}
        <div className="border border-lichen rounded-md divide-y divide-lichen mb-4">
          {objectsQuery.isLoading ? (
            <p className="text-sm text-archive p-4">Loading objects…</p>
          ) : objectsQuery.isError ? (
            <p className="text-sm text-semantic-error p-4">Could not load objects.</p>
          ) : hits.length === 0 ? (
            <p className="text-sm text-archive p-4">
              No discoverable objects found. Mark objects as discoverable to include them here.
            </p>
          ) : (
            hits.map((hit) => {
              const checked = selectedIds.has(hit.object_id);
              const disabled = !checked && atCap;
              const hasImage = !!hit.primary_image_url;
              return (
                <label
                  key={hit.object_id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-stone/30 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleOne(hit.object_id)}
                    aria-label={`Select ${hit.title || hit.object_name || 'object'}${hit.object_number ? ` (${hit.object_number})` : ''}`}
                    className="accent-bark focus-visible:ring-2 ring-bark/30 ring-offset-2"
                  />
                  {hasImage ? (
                    <img
                      src={hit.primary_image_url ?? ''}
                      alt=""
                      className="w-8 h-8 rounded object-cover border border-lichen flex-shrink-0"
                    />
                  ) : (
                    <span className="w-8 h-8 rounded border border-lichen bg-parchment-warm flex items-center justify-center flex-shrink-0" title="No image">
                      <ImageOff className="w-4 h-4 text-archive" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink truncate">
                      {hit.title || hit.object_name || 'Untitled'}
                    </span>
                    {hit.object_number && (
                      <span className="block text-xs text-archive truncate">{hit.object_number}</span>
                    )}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-tertiary disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-archive">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="btn-tertiary disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}

        {/* Layout picker + generate */}
        <div className="flex flex-wrap items-center gap-4">
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">Label layout</legend>
            <span className="text-sm font-medium text-ink">Layout:</span>
            {(['4up', '6up'] as LabelLayout[]).map((opt) => (
              <label key={opt} className="inline-flex items-center gap-1.5 text-sm text-accessible-gray cursor-pointer">
                <input
                  type="radio"
                  name="label-layout"
                  value={opt}
                  checked={layout === opt}
                  onChange={() => setLayout(opt)}
                  aria-label={opt === '4up' ? '4 per page' : '6 per page'}
                  className="accent-bark focus-visible:ring-2 ring-bark/30 ring-offset-2"
                />
                {opt === '4up' ? '4 per page' : '6 per page'}
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            onClick={() => generatePdfMutation.mutate()}
            disabled={selectedIds.size === 0 || generatePdfMutation.isPending}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            {generatePdfMutation.isPending ? 'Generating…' : 'Generate PDF'}
          </button>
          {generatePdfMutation.isError && (
            <span className="text-sm text-semantic-error">PDF generation failed — try again.</span>
          )}
        </div>
      </section>
    </div>
  );
}
