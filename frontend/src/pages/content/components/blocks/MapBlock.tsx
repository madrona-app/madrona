/**
 * Map Block — Embedded map with pin marker.
 *
 * Uses an OpenStreetMap iframe embed (no API key required).
 * Editor allows setting coordinates, zoom, and marker label.
 */

// =============================================================================
// Shared Types
// =============================================================================

interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

type MapStyle = 'streets' | 'satellite';

// =============================================================================
// Helpers
// =============================================================================

function buildMapUrl(lat: number, lng: number, _zoom: number, _style: MapStyle): string {
  // OpenStreetMap embed URL — free, no API key
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}&layer=mapnik&marker=${lat},${lng}`;
}

function buildMapLinkUrl(lat: number, lng: number, zoom: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
}

// =============================================================================
// Editor
// =============================================================================

export function MapEditor({ content, onChange }: BlockEditorComponentProps) {
  const lat = (content.lat as number) ?? 40.7794;
  const lng = (content.lng as number) ?? -73.9632;
  const zoom = (content.zoom as number) ?? 15;
  const markerLabel = (content.marker_label as string) || '';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Latitude <span className="text-semantic-error">*</span>
          </label>
          <input
            type="number"
            step="any"
            value={lat}
            onChange={(e) =>
              onChange({ ...content, lat: parseFloat(e.target.value) || 0 })
            }
            placeholder="40.7794"
            className="input w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Longitude <span className="text-semantic-error">*</span>
          </label>
          <input
            type="number"
            step="any"
            value={lng}
            onChange={(e) =>
              onChange({ ...content, lng: parseFloat(e.target.value) || 0 })
            }
            placeholder="-73.9632"
            className="input w-full text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Zoom Level
          </label>
          <input
            type="number"
            min={1}
            max={19}
            value={zoom}
            onChange={(e) =>
              onChange({
                ...content,
                zoom: Math.max(1, Math.min(19, parseInt(e.target.value) || 15)),
              })
            }
            className="input w-full text-sm"
          />
          <p className="text-xs text-archive mt-1">1 (world) to 19 (building)</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Marker Label
          </label>
          <input
            type="text"
            value={markerLabel}
            onChange={(e) =>
              onChange({ ...content, marker_label: e.target.value })
            }
            placeholder="e.g., The Metropolitan Museum of Art"
            className="input w-full text-sm"
          />
        </div>
      </div>

      {/* Live preview */}
      {lat && lng ? (
        <div className="pt-2">
          <p className="text-xs text-archive mb-2">Preview:</p>
          <MapRenderer content={content} />
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function MapRenderer({ content }: BlockRendererComponentProps) {
  const lat = (content.lat as number) ?? 0;
  const lng = (content.lng as number) ?? 0;
  const zoom = (content.zoom as number) ?? 15;
  const markerLabel = (content.marker_label as string) || '';
  const style = (content.style as MapStyle) || 'streets';

  if (!lat && !lng) {
    return null;
  }

  const embedUrl = buildMapUrl(lat, lng, zoom, style);
  const linkUrl = buildMapLinkUrl(lat, lng, zoom);

  return (
    <div className="space-y-2">
      {markerLabel && (
        <p className="text-sm font-medium text-ink">{markerLabel}</p>
      )}
      <div className="relative w-full rounded-lg overflow-hidden border border-lichen" style={{ paddingBottom: '56.25%' }}>
        <iframe
          src={embedUrl}
          className="absolute inset-0 w-full h-full"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer"
          title={markerLabel || 'Map'}
        />
      </div>
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-bark hover:text-copper-dark transition-colors"
      >
        View larger map &rarr;
      </a>
    </div>
  );
}
