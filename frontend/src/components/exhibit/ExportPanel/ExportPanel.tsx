/**
 * ExportPanel - UI for generating PDF exports
 *
 * Provides options for:
 * - Elevation drawings (wall-by-wall scaled drawings)
 * - Installation specifications (mounting heights, hardware)
 * - Object checklists (condition check boxes)
 * - Execution Pack: Checklist PDF, Shipment PDF, Object List CSV/PDF, Budget CSV
 */
import { useState } from 'react';
import Checkbox from '../../Checkbox';
import { FileDown, Ruler, ClipboardList, Wrench, Loader2, Check, AlertCircle, Package, Truck, DollarSign, List } from 'lucide-react';

interface Wall {
  id: string;
  name?: string;
}

interface ExportPanelProps {
  exhibitionId: string;
  organizationId: string;
  floorPlanId?: string;
  walls: Wall[];
}

type ExportType = 'elevation' | 'installation' | 'checklist';
type ExecutionPackExportType = 'checklistPdf' | 'shipmentPdf' | 'objectListCsv' | 'objectListPdf' | 'budgetCsv';

interface ExportState {
  loading: boolean;
  success: boolean;
  error: string | null;
}

export default function ExportPanel({
  exhibitionId,
  organizationId,
  floorPlanId,
  walls,
}: ExportPanelProps) {
  const [selectedWall, setSelectedWall] = useState<string | 'all'>('all');
  const [scale, setScale] = useState(50);
  const [includeDimensions, setIncludeDimensions] = useState(true);
  const [includeImages, setIncludeImages] = useState(false);

  const [exportState, setExportState] = useState<Record<ExportType, ExportState>>({
    elevation: { loading: false, success: false, error: null },
    installation: { loading: false, success: false, error: null },
    checklist: { loading: false, success: false, error: null },
  });

  // Execution Pack state
  const [executionPackState, setExecutionPackState] = useState<Record<ExecutionPackExportType, ExportState>>({
    checklistPdf: { loading: false, success: false, error: null },
    shipmentPdf: { loading: false, success: false, error: null },
    objectListCsv: { loading: false, success: false, error: null },
    objectListPdf: { loading: false, success: false, error: null },
    budgetCsv: { loading: false, success: false, error: null },
  });

  // Execution Pack options
  const [checklistPhase, setChecklistPhase] = useState<string>('');
  const [includeLineItems, setIncludeLineItems] = useState(true);

  const handleExport = async (type: ExportType) => {
    setExportState((prev) => ({
      ...prev,
      [type]: { loading: true, success: false, error: null },
    }));

    try {
      let endpoint = '';
      let body: Record<string, unknown> = {};

      switch (type) {
        case 'elevation':
          endpoint = `/api/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/exports/elevation-pdf`;
          body = {
            floor_plan_id: floorPlanId,
            wall_id: selectedWall === 'all' ? null : selectedWall,
            scale,
            include_dimensions: includeDimensions,
          };
          break;
        case 'installation':
          endpoint = `/api/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/exports/installation-spec`;
          body = {
            floor_plan_id: floorPlanId,
          };
          break;
        case 'checklist':
          endpoint = `/api/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/exports/object-checklist`;
          body = {
            include_images: includeImages,
          };
          break;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1] || `export.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExportState((prev) => ({
        ...prev,
        [type]: { loading: false, success: true, error: null },
      }));

      // Reset success indicator after 3 seconds
      setTimeout(() => {
        setExportState((prev) => ({
          ...prev,
          [type]: { ...prev[type], success: false },
        }));
      }, 3000);
    } catch (error) {
      setExportState((prev) => ({
        ...prev,
        [type]: {
          loading: false,
          success: false,
          error: error instanceof Error ? error.message : 'Export failed',
        },
      }));
    }
  };

  const handleExecutionPackExport = async (exportType: ExecutionPackExportType) => {
    setExecutionPackState((prev) => ({
      ...prev,
      [exportType]: { loading: true, success: false, error: null },
    }));

    try {
      // Map export type to endpoint and file extension
      const exportConfig: Record<ExecutionPackExportType, { endpoint: string; extension: string }> = {
        checklistPdf: { endpoint: 'checklist-pdf', extension: 'pdf' },
        shipmentPdf: { endpoint: 'shipment-pdf', extension: 'pdf' },
        objectListCsv: { endpoint: 'object-list-csv', extension: 'csv' },
        objectListPdf: { endpoint: 'object-list-pdf', extension: 'pdf' },
        budgetCsv: { endpoint: 'budget-csv', extension: 'csv' },
      };

      const config = exportConfig[exportType];
      const endpoint = `/api/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/exports/execution-pack/${config.endpoint}`;

      // Build request body based on export type
      let body: Record<string, unknown> = {};
      if (exportType === 'checklistPdf') {
        body = { phase: checklistPhase || null, include_completed: true };
      } else if (exportType === 'budgetCsv') {
        body = { include_line_items: includeLineItems };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || `export.${config.extension}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExecutionPackState((prev) => ({
        ...prev,
        [exportType]: { loading: false, success: true, error: null },
      }));

      // Reset success indicator after 3 seconds
      setTimeout(() => {
        setExecutionPackState((prev) => ({
          ...prev,
          [exportType]: { ...prev[exportType], success: false },
        }));
      }, 3000);
    } catch (error) {
      setExecutionPackState((prev) => ({
        ...prev,
        [exportType]: {
          loading: false,
          success: false,
          error: error instanceof Error ? error.message : 'Export failed',
        },
      }));
    }
  };

  return (
    <div className="bg-parchment rounded-lg shadow-sm border border-fog overflow-hidden">
      <div className="px-4 py-3 border-b border-fog bg-mist">
        <h3 className="font-medium text-ink flex items-center gap-2">
          <FileDown className="w-4 h-4" />
          Export Documents
        </h3>
      </div>

      <div className="p-4 space-y-6">
        {/* Elevation PDF */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-ink">
            <Ruler className="w-4 h-4 text-forest" />
            <span className="font-medium">Elevation Drawings</span>
          </div>
          <p className="text-sm text-ink/60">
            Wall-by-wall scaled drawings with artwork positions and dimensions.
          </p>

          <div className="space-y-2">
            <div>
              <label className="text-xs text-ink/70">Wall Selection</label>
              <select
                value={selectedWall}
                onChange={(e) => setSelectedWall(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-fog rounded-lg text-sm"
              >
                <option value="all">All Walls</option>
                {walls.map((wall) => (
                  <option key={wall.id} value={wall.id}>
                    {wall.name || wall.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-ink/70">Scale</label>
              <select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border border-fog rounded-lg text-sm"
              >
                <option value={20}>1:20 (Large)</option>
                <option value={50}>1:50 (Standard)</option>
                <option value={100}>1:100 (Small)</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeDimensions}
                onChange={(e) => setIncludeDimensions(e.target.checked)}
              />
              <span>Include dimension lines</span>
            </label>
          </div>

          <ExportButton
            onClick={() => handleExport('elevation')}
            state={exportState.elevation}
            label="Export Elevation PDF"
          />
        </div>

        <hr className="border-fog" />

        {/* Installation Spec */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-ink">
            <Wrench className="w-4 h-4 text-forest" />
            <span className="font-medium">Installation Specifications</span>
          </div>
          <p className="text-sm text-ink/60">
            Mounting heights, hardware requirements, and wall preparation notes.
          </p>

          <ExportButton
            onClick={() => handleExport('installation')}
            state={exportState.installation}
            label="Export Installation Spec"
          />
        </div>

        <hr className="border-fog" />

        {/* Object Checklist */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-ink">
            <ClipboardList className="w-4 h-4 text-forest" />
            <span className="font-medium">Object Checklist</span>
          </div>
          <p className="text-sm text-ink/60">
            Artwork list with condition check boxes and installation sign-off fields.
          </p>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeImages}
              onChange={(e) => setIncludeImages(e.target.checked)}
            />
            <span>Include artwork thumbnails</span>
          </label>

          <ExportButton
            onClick={() => handleExport('checklist')}
            state={exportState.checklist}
            label="Export Object Checklist"
          />
        </div>

        <hr className="border-fog" />

        {/* Execution Pack */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-ink">
            <Package className="w-4 h-4 text-forest" />
            <span className="font-medium">Execution Pack</span>
          </div>
          <p className="text-sm text-ink/60">
            Documents for exhibition logistics and execution.
          </p>

          {/* Checklist PDF */}
          <div className="space-y-2 pl-6 border-l-2 border-fog">
            <div className="flex items-center gap-2 text-sm text-ink">
              <ClipboardList className="w-3.5 h-3.5 text-forest" />
              <span className="font-medium">Task Checklist</span>
            </div>
            <p className="text-xs text-ink/60">
              Tasks grouped by phase with status and due dates.
            </p>

            <div>
              <label className="text-xs text-ink/70">Filter by Phase</label>
              <select
                value={checklistPhase}
                onChange={(e) => setChecklistPhase(e.target.value)}
                className="w-full mt-1 px-3 py-1.5 border border-fog rounded-lg text-sm"
              >
                <option value="">All Phases</option>
                <option value="planning">Planning</option>
                <option value="pre_install">Pre-Install</option>
                <option value="install">Install</option>
                <option value="open">Open</option>
                <option value="close">Close</option>
                <option value="deinstall">Deinstall</option>
                <option value="travel">Travel</option>
              </select>
            </div>

            <ExportButton
              onClick={() => handleExecutionPackExport('checklistPdf')}
              state={executionPackState.checklistPdf}
              label="Export Checklist PDF"
            />
          </div>

          {/* Shipment Summary PDF */}
          <div className="space-y-2 pl-6 border-l-2 border-fog">
            <div className="flex items-center gap-2 text-sm text-ink">
              <Truck className="w-3.5 h-3.5 text-forest" />
              <span className="font-medium">Shipment Summary</span>
            </div>
            <p className="text-xs text-ink/60">
              Tracking numbers, carriers, and dates grouped by direction.
            </p>

            <ExportButton
              onClick={() => handleExecutionPackExport('shipmentPdf')}
              state={executionPackState.shipmentPdf}
              label="Export Shipment PDF"
            />
          </div>

          {/* Object List */}
          <div className="space-y-2 pl-6 border-l-2 border-fog">
            <div className="flex items-center gap-2 text-sm text-ink">
              <List className="w-3.5 h-3.5 text-forest" />
              <span className="font-medium">Object List</span>
            </div>
            <p className="text-xs text-ink/60">
              Objects with lender, packing notes, and placement status.
            </p>

            <div className="flex gap-2">
              <div className="flex-1">
                <ExportButton
                  onClick={() => handleExecutionPackExport('objectListCsv')}
                  state={executionPackState.objectListCsv}
                  label="CSV"
                />
              </div>
              <div className="flex-1">
                <ExportButton
                  onClick={() => handleExecutionPackExport('objectListPdf')}
                  state={executionPackState.objectListPdf}
                  label="PDF"
                />
              </div>
            </div>
          </div>

          {/* Budget CSV */}
          <div className="space-y-2 pl-6 border-l-2 border-fog">
            <div className="flex items-center gap-2 text-sm text-ink">
              <DollarSign className="w-3.5 h-3.5 text-forest" />
              <span className="font-medium">Budget Export</span>
            </div>
            <p className="text-xs text-ink/60">
              Category totals and line items with estimated vs actual.
            </p>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeLineItems}
                onChange={(e) => setIncludeLineItems(e.target.checked)}
              />
              <span>Include line items</span>
            </label>

            <ExportButton
              onClick={() => handleExecutionPackExport('budgetCsv')}
              state={executionPackState.budgetCsv}
              label="Export Budget CSV"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportButton({
  onClick,
  state,
  label,
}: {
  onClick: () => void;
  state: ExportState;
  label: string;
}) {
  return (
    <div>
      <button
        onClick={onClick}
        disabled={state.loading}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          state.success
            ? 'bg-semantic-success text-parchment'
            : state.error
            ? 'bg-semantic-error/10 text-semantic-error border border-semantic-error/30'
            : 'bg-forest text-parchment hover:bg-forest/90'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {state.loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating...
          </>
        ) : state.success ? (
          <>
            <Check className="w-4 h-4" />
            Downloaded!
          </>
        ) : state.error ? (
          <>
            <AlertCircle className="w-4 h-4" />
            {label}
          </>
        ) : (
          <>
            <FileDown className="w-4 h-4" />
            {label}
          </>
        )}
      </button>
      {state.error && <p className="mt-1 text-xs text-semantic-error">{state.error}</p>}
    </div>
  );
}
