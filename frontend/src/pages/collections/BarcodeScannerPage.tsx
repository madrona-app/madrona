import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ScanBarcode,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MapPin,
  Camera,
  CameraOff,
  Settings2,
  ChevronDown,
  CornerDownLeft,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { apiFetch } from '../../lib/apiClient';
import { formatTime as fmtTime } from '@/lib/formatters';

interface ScanResult {
  scan_id: string;
  barcode_value: string;
  resolved_entity_type: string | null;
  resolved_entity_type_label: string | null;
  resolved_entity_id: string | null;
  action_type: string;
  action_type_label: string;
  result_status: string;
  result_status_label: string;
  scanned_at: string;
  entity_summary?: Record<string, string | null>;
  action_detail?: Record<string, string | null>;
}

interface LocationOption {
  location_id: string;
  name: string;
  code: string;
}

interface CampaignOption {
  audit_id: string;
  title: string;
  audit_number: string;
  status: string;
}

const ACTION_TYPES = [
  { value: 'lookup', label: 'Lookup' },
  { value: 'verify', label: 'Verify' },
  { value: 'move', label: 'Move' },
  { value: 'audit', label: 'Audit' },
  { value: 'checkout', label: 'Check Out' },
  { value: 'checkin', label: 'Check In' },
];

const LOCATION_REQUIRED = new Set(['verify', 'move', 'checkin']);

const RESULT_ICONS: Record<string, typeof CheckCircle2> = {
  success: CheckCircle2,
  not_found: XCircle,
  mismatch: AlertTriangle,
  error: XCircle,
};

const RESULT_STYLES: Record<string, string> = {
  success: 'text-semantic-success',
  not_found: 'text-semantic-error',
  mismatch: 'text-semantic-warning',
  error: 'text-semantic-error',
};

const RESULT_BG: Record<string, string> = {
  success: 'bg-semantic-success/10 border-semantic-success/30',
  not_found: 'bg-semantic-error/10 border-semantic-error/30',
  mismatch: 'bg-semantic-warning/10 border-semantic-warning/30',
  error: 'bg-semantic-error/10 border-semantic-error/30',
};

const formatTime = (dateStr: string): string => {
  return fmtTime(dateStr);
};

export default function BarcodeScannerPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [actionType, setActionType] = useState('lookup');
  const [locationId, setLocationId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [recentScans, setRecentScans] = useState<ScanResult[]>([]);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const lastScannedRef = useRef<string>('');
  const cooldownRef = useRef(false);

  // Refs for latest state values (accessible in scanner callback)
  const actionTypeRef = useRef(actionType);
  const locationIdRef = useRef(locationId);
  const campaignIdRef = useRef(campaignId);
  useEffect(() => { actionTypeRef.current = actionType; }, [actionType]);
  useEffect(() => { locationIdRef.current = locationId; }, [locationId]);
  useEffect(() => { campaignIdRef.current = campaignId; }, [campaignId]);

  const { data: locationsData } = useQuery({
    queryKey: ['scanner-locations', orgId],
    queryFn: () =>
      apiFetch<{ items: LocationOption[] }>(
        `/organizations/${orgId}/collections/locations?limit=200`
      ),
    enabled: !!orgId,
  });

  const { data: campaignsData } = useQuery({
    queryKey: ['scanner-campaigns', orgId],
    queryFn: () =>
      apiFetch<{ items: CampaignOption[] }>(
        `/organizations/${orgId}/collections/audits?limit=50`
      ),
    enabled: !!orgId && actionType === 'audit',
  });

  const processBarcode = useCallback(async (barcodeValue: string) => {
    if (!orgId || !barcodeValue.trim()) return;

    // Debounce duplicate scans
    if (cooldownRef.current && barcodeValue === lastScannedRef.current) return;
    lastScannedRef.current = barcodeValue;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 2000);

    setIsProcessing(true);
    try {
      const result = await apiFetch<ScanResult>(
        `/organizations/${orgId}/collections/barcodes/scan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            barcode_value: barcodeValue.trim(),
            action_type: actionTypeRef.current,
            scan_location_id: locationIdRef.current || undefined,
            campaign_id: (actionTypeRef.current === 'audit' && campaignIdRef.current) ? campaignIdRef.current : undefined,
          }),
        }
      );

      setLastResult(result);
      setRecentScans((prev) => [result, ...prev].slice(0, 20));
    } catch {
      const errorResult: ScanResult = {
        scan_id: '',
        barcode_value: barcodeValue,
        resolved_entity_type: null,
        resolved_entity_type_label: null,
        resolved_entity_id: null,
        action_type: actionTypeRef.current,
        action_type_label: ACTION_TYPES.find((a) => a.value === actionTypeRef.current)?.label || actionTypeRef.current,
        result_status: 'error',
        result_status_label: 'Error',
        scanned_at: new Date().toISOString(),
      };
      setLastResult(errorResult);
      setRecentScans((prev) => [errorResult, ...prev].slice(0, 20));
    } finally {
      setIsProcessing(false);
    }
  }, [orgId]);

  const startCamera = useCallback(async () => {
    if (!viewfinderRef.current) return;
    setCameraError(null);

    try {
      const scanner = new Html5Qrcode('scanner-viewfinder');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => { processBarcode(decodedText); },
        () => { /* ignore scan failures — camera is just looking */ },
      );

      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setCameraError('Camera access denied. Check your browser permissions.');
      } else {
        setCameraError('Unable to start camera. Is another app using it?');
      }
    }
  }, [processBarcode]);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch { /* already stopped */ }
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const ResultIcon = lastResult ? (RESULT_ICONS[lastResult.result_status] || XCircle) : null;
  const resultStyle = lastResult ? (RESULT_STYLES[lastResult.result_status] || '') : '';
  const resultBg = lastResult ? (RESULT_BG[lastResult.result_status] || '') : '';

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header — compact for mobile */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <ScanBarcode className="h-5 w-5 text-bark" />
          <h1 className="text-2xl font-semibold text-ink">Scanner</h1>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-lg transition-colors ${
            showSettings ? 'bg-azurite/10 text-azurite' : 'text-archive hover:text-ink'
          }`}
        >
          <Settings2 className="h-5 w-5" />
        </button>
      </div>

      {/* Settings panel — collapsible */}
      {showSettings && (
        <div className="border border-lichen rounded-xl bg-parchment p-4 mb-4 space-y-3">
          {/* Action type */}
          <div>
            <p className="text-xs uppercase tracking-wider text-archive mb-1.5">Action</p>
            <div className="flex flex-wrap gap-1.5">
              {ACTION_TYPES.map((action) => (
                <button
                  key={action.value}
                  onClick={() => setActionType(action.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    actionType === action.value
                      ? 'bg-bark text-parchment'
                      : 'bg-stone/60 text-ink hover:bg-stone'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div>
            <p className="text-xs uppercase tracking-wider text-archive mb-1.5">
              <MapPin className="inline h-3 w-3 mr-0.5 -mt-0.5" />
              Location
            </p>
            <div className="relative">
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm bg-parchment appearance-none pr-8"
              >
                <option value="">None</option>
                {locationsData?.items?.map((loc) => (
                  <option key={loc.location_id} value={loc.location_id}>
                    {loc.name} ({loc.code})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-archive pointer-events-none" />
            </div>
          </div>

          {/* Campaign (audit only) */}
          {actionType === 'audit' && (
            <div>
              <p className="text-xs uppercase tracking-wider text-archive mb-1.5">Campaign</p>
              <div className="relative">
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm bg-parchment appearance-none pr-8"
                >
                  <option value="">Select campaign</option>
                  {campaignsData?.items
                    ?.filter((c) => c.status !== 'completed' && c.status !== 'cancelled')
                    .map((c) => (
                    <option key={c.audit_id} value={c.audit_id}>
                      {c.audit_number} — {c.title}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-archive pointer-events-none" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active mode indicator */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className="px-2 py-0.5 rounded bg-azurite/10 text-azurite font-medium text-xs">
          {ACTION_TYPES.find((a) => a.value === actionType)?.label}
        </span>
        {locationId && locationsData?.items && (
          <span className="px-2 py-0.5 rounded bg-stone/60 text-ink text-xs flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {locationsData.items.find((l) => l.location_id === locationId)?.name || 'Location'}
          </span>
        )}
      </div>

      {/* Location required warning */}
      {LOCATION_REQUIRED.has(actionType) && !locationId && (
        <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-semantic-warning/10 border border-semantic-warning/20">
          <AlertTriangle className="h-4 w-4 text-semantic-warning shrink-0" />
          <p className="text-xs text-semantic-warning">
            Set a location before scanning — {actionType === 'verify' ? 'verify' : actionType === 'move' ? 'move' : 'check in'} needs to know where you are.
          </p>
          <button
            onClick={() => setShowSettings(true)}
            className="ml-auto text-xs font-medium text-bark shrink-0"
          >
            Set location
          </button>
        </div>
      )}

      {/* Manual entry.
        *
        * Not a fallback — for two groups it is the only way in. A USB/Bluetooth
        * wedge scanner (what most collections actually own) emits keystrokes and
        * an Enter, so it needs a focused text input and never touches the
        * camera. And a keyboard-only or screen-reader user cannot aim a
        * viewfinder at all. The camera below is the convenience; this is the
        * interface.
        */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = manualValue.trim();
          if (!value) return;
          void processBarcode(value);
          setManualValue('');
        }}
        className="flex items-center gap-2 mb-4"
      >
        <label htmlFor="barcode-manual-entry" className="sr-only">
          Barcode or object number
        </label>
        {/* eslint-disable-next-line jsx-a11y/control-has-associated-label --
            the sr-only <label htmlFor> above IS the association; this rule does
            not follow htmlFor/id across siblings. */}
        <input
          id="barcode-manual-entry"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          // A wedge scanner types the value then sends Enter, so the input must
          // already hold focus when the operator pulls the trigger. That is the
          // whole reason this field exists, so the usual objection to autofocus
          // (stealing focus from what the user chose) is inverted here.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          placeholder="Scan or type a barcode, then press Enter"
          disabled={isProcessing}
          className="flex-1 min-w-0 px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink text-sm placeholder:text-archive focus:outline-none focus:ring-2 focus:ring-azurite disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isProcessing || !manualValue.trim()}
          className="px-3 py-2 bg-bark text-parchment rounded-lg text-sm font-medium hover:bg-bark/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
        >
          <CornerDownLeft className="h-4 w-4" aria-hidden="true" />
          Look up
        </button>
      </form>

      {/* Camera viewfinder */}
      <div className="relative rounded-xl overflow-hidden bg-ink mb-4 aspect-square">
        {!cameraActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
            {cameraError ? (
              <>
                <CameraOff className="h-10 w-10 text-parchment/40" />
                <p className="text-sm text-parchment/60 text-center px-8">{cameraError}</p>
                <button
                  onClick={startCamera}
                  className="px-4 py-2 bg-bark text-parchment rounded-lg text-sm font-medium hover:bg-bark/90"
                >
                  Try Again
                </button>
              </>
            ) : (
              <>
                <Camera className="h-12 w-12 text-parchment/30" />
                <button
                  onClick={startCamera}
                  className="px-5 py-2.5 bg-bark text-parchment rounded-lg font-medium hover:bg-bark/90 flex items-center gap-2"
                >
                  <Camera className="h-4 w-4" />
                  Start Camera
                </button>
                <p className="text-xs text-parchment/40">Point at a barcode or QR code</p>
              </>
            )}
          </div>
        )}

        <div id="scanner-viewfinder" ref={viewfinderRef} className="w-full h-full" />

        {/* Processing overlay */}
        {isProcessing && cameraActive && (
          <div className="absolute inset-0 bg-ink/40 flex items-center justify-center z-20">
            <div className="bg-parchment rounded-xl px-4 py-3 flex items-center gap-2 shadow-lg">
              <Loader2 className="h-4 w-4 animate-spin text-bark" />
              <span className="text-sm font-medium text-ink">Looking up...</span>
            </div>
          </div>
        )}

        {/* Camera controls */}
        {cameraActive && (
          <button
            onClick={stopCamera}
            className="absolute top-3 right-3 z-20 p-2 bg-ink/60 rounded-lg text-parchment hover:bg-ink/80 transition-colors"
          >
            <CameraOff className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Last result — prominent feedback */}
      {lastResult && (
        <div className={`border rounded-xl p-4 mb-4 ${resultBg}`}>
          <div className="flex items-start gap-3">
            {ResultIcon && <ResultIcon className={`h-5 w-5 mt-0.5 shrink-0 ${resultStyle}`} />}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <p className="font-mono font-semibold text-ink text-sm truncate">{lastResult.barcode_value}</p>
                <p className={`text-xs font-medium shrink-0 ${resultStyle}`}>{lastResult.result_status_label}</p>
              </div>
              {lastResult.resolved_entity_type_label && (
                <p className="text-sm text-ink mt-0.5">
                  <span className="text-archive">{lastResult.resolved_entity_type_label}</span>
                  {lastResult.entity_summary && (
                    <span className="ml-1.5 font-medium">
                      {lastResult.entity_summary.object_number || lastResult.entity_summary.name || lastResult.entity_summary.part_name || ''}
                    </span>
                  )}
                </p>
              )}
              {lastResult.entity_summary?.title && (
                <p className="text-sm text-archive italic mt-0.5 truncate">{lastResult.entity_summary.title}</p>
              )}
              {/* Action detail */}
              {lastResult.action_detail && Object.keys(lastResult.action_detail).length > 0 && (
                <div className="mt-2 pt-2 border-t border-ink/10 space-y-0.5">
                  {lastResult.action_detail.movement_ref && (
                    <p className="text-xs text-archive">
                      Movement <span className="font-mono font-medium text-ink">{lastResult.action_detail.movement_ref}</span>
                    </p>
                  )}
                  {lastResult.action_detail.from_location && lastResult.action_detail.to_location && (
                    <p className="text-xs text-archive">
                      {lastResult.action_detail.from_location} → {lastResult.action_detail.to_location}
                    </p>
                  )}
                  {!lastResult.action_detail.from_location && lastResult.action_detail.to_location && (
                    <p className="text-xs text-archive">
                      → {lastResult.action_detail.to_location}
                    </p>
                  )}
                  {lastResult.action_detail.from_location && !lastResult.action_detail.to_location && (
                    <p className="text-xs text-archive">
                      Checked out from {lastResult.action_detail.from_location}
                    </p>
                  )}
                  {lastResult.action_detail.expected_location && lastResult.action_detail.actual_location && (
                    <p className="text-xs text-semantic-warning">
                      Expected: {lastResult.action_detail.expected_location} — Found here: {lastResult.action_detail.actual_location}
                    </p>
                  )}
                  {lastResult.action_detail.note && (
                    <p className="text-xs text-archive">{lastResult.action_detail.note}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent scans */}
      {recentScans.length > 1 && (
        <div className="border border-lichen rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-lichen bg-stone/20">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-archive">
              History ({recentScans.length})
            </h2>
          </div>
          <div className="divide-y divide-lichen max-h-64 overflow-y-auto">
            {recentScans.slice(1).map((scan, idx) => {
              const Icon = RESULT_ICONS[scan.result_status] || XCircle;
              const style = RESULT_STYLES[scan.result_status] || '';
              return (
                <div key={scan.scan_id || idx} className="px-4 py-2 flex items-center gap-2.5 text-sm">
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${style}`} />
                  <span className="font-mono text-xs text-ink truncate">{scan.barcode_value}</span>
                  {scan.entity_summary && (
                    <span className="text-xs text-archive truncate">
                      {scan.entity_summary.object_number || scan.entity_summary.name || ''}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-archive shrink-0">{formatTime(scan.scanned_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
