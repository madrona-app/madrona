import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, Trash2, FileText, Info } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import {
  listReportTemplates,
  uploadReportTemplate,
  deleteReportTemplate,
  getReportTemplateDownloadUrl,
  getDefaultTemplateDownloadUrl,
} from '../../lib/api/report-templates';
import { formatDateTime } from '@/lib/formatters';
import type { ReportTemplate } from '../../lib/api/report-templates';

/** Known built-in templates and their descriptions. */
const KNOWN_TEMPLATES: { filename: string; description: string }[] = [
  {
    filename: 'object_record_sheet.html',
    description: 'Object Record Sheet — single-object summary report',
  },
  {
    filename: 'condition_report.html',
    description: 'Condition Report — condition assessment document',
  },
  {
    filename: 'loan_agreement.html',
    description: 'Loan Agreement — incoming and outgoing loan agreements',
  },
  {
    filename: 'object_entry_report.html',
    description: 'Object Entry Report — objects received into custody',
  },
  {
    filename: 'object_exit_report.html',
    description: 'Object Exit Report — objects dispatched from the institution',
  },
  {
    filename: 'conservation_treatment_report.html',
    description: 'Conservation Treatment Report — treatment records with methods and outcomes',
  },
  {
    filename: 'acquisition_report.html',
    description: 'Acquisition Report — acquisition with source, financial, and legal details',
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  return formatDateTime(iso);
}

export default function ReportTemplatesSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['report-templates', organizationId],
    queryFn: () => listReportTemplates(organizationId!),
    enabled: !!organizationId,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadReportTemplate(organizationId!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-templates', organizationId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => deleteReportTemplate(organizationId!, filename),
    onSuccess: () => {
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['report-templates', organizationId] });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">Report Templates</h1>
        <p className="mt-1 text-sm text-archive">
          Upload custom HTML templates to override the built-in report layouts.
        </p>
      </div>

      {/* Info box */}
      <div className="mb-6 rounded-md border border-semantic-info/20 bg-semantic-info/5 p-4">
        <div className="flex gap-3">
          <Info size={18} className="mt-0.5 flex-shrink-0 text-semantic-info" />
          <div className="text-sm text-ink">
            <p className="font-medium mb-1">How template overrides work</p>
            <p className="text-archive mb-2">
              Upload an HTML file whose name matches a built-in template. The system will use your
              version instead of the default when generating that report. Templates use Jinja2 syntax
              and are rendered with WeasyPrint.
            </p>
            <p className="font-medium mb-1">Available template names</p>
            <ul className="list-disc list-inside text-archive space-y-1.5">
              {KNOWN_TEMPLATES.map((t) => (
                <li key={t.filename} className="flex items-center gap-2">
                  <span>
                    <code className="text-xs bg-stone/50 px-1 py-0.5 rounded">{t.filename}</code>
                    {' — '}
                    {t.description}
                  </span>
                  <a
                    href={getDefaultTemplateDownloadUrl(organizationId!, t.filename)}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-bark hover:bg-bark/10 transition-colors whitespace-nowrap"
                  >
                    <Download size={12} />
                    Download default
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Upload */}
      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".html"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-medium"
        >
          <Upload size={16} />
          {uploadMutation.isPending ? 'Uploading...' : 'Upload Template'}
        </button>

        {uploadMutation.isError && (
          <p className="mt-2 text-sm text-semantic-error">
            {uploadMutation.error instanceof Error
              ? uploadMutation.error.message
              : 'Upload failed'}
          </p>
        )}
        {uploadMutation.isSuccess && (
          <p className="mt-2 text-sm text-semantic-success">Template uploaded.</p>
        )}
      </div>

      {/* Template list */}
      {isLoading ? (
        <p className="text-sm text-archive">Loading templates...</p>
      ) : templates.length === 0 ? (
        <div className="rounded-md border border-dashed border-lichen p-8 text-center">
          <FileText size={32} className="mx-auto mb-2 text-archive" />
          <p className="text-sm text-archive">No custom templates uploaded yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-lichen">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lichen bg-stone/30">
                <th className="px-4 py-2 text-left font-medium text-ink">Name</th>
                <th className="px-4 py-2 text-left font-medium text-ink">Size</th>
                <th className="px-4 py-2 text-left font-medium text-ink">Uploaded</th>
                <th className="px-4 py-2 text-right font-medium text-ink">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t: ReportTemplate) => (
                <tr key={t.name} className="border-b border-lichen last:border-b-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{t.name}</td>
                  <td className="px-4 py-2.5 text-archive">{formatBytes(t.size)}</td>
                  <td className="px-4 py-2.5 text-archive">{formatDate(t.last_modified)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <a
                        href={getReportTemplateDownloadUrl(organizationId!, t.name)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-bark hover:bg-bark/10 transition-colors"
                      >
                        <Download size={14} />
                        Download
                      </a>
                      {confirmDelete === t.name ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(t.name)}
                            disabled={deleteMutation.isPending}
                            className="rounded px-2 py-1 text-xs font-medium text-parchment bg-semantic-error hover:bg-semantic-error/80 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className="rounded px-2 py-1 text-xs text-archive hover:bg-stone transition-colors"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(t.name)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-semantic-error hover:bg-semantic-error/10 transition-colors"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteMutation.isError && (
        <p className="mt-2 text-sm text-semantic-error">
          {deleteMutation.error instanceof Error
            ? deleteMutation.error.message
            : 'Delete failed'}
        </p>
      )}
    </div>
  );
}
