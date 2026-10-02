/**
 * ImageCropEditor — crop/transform editor for images using react-easy-crop.
 * Used on MediaDetailPage for download transforms.
 */
import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { useMutation } from '@tanstack/react-query';
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Download,
  Loader2,
  ZoomIn,
} from 'lucide-react';
import { transformImage, type TransformParams } from '../../lib/api/media-dam';
import { useToast } from '../../contexts/ToastContext';

interface ImageCropEditorProps {
  organizationId: string;
  mediaId: string;
  imageUrl: string;
  width: number;
  height: number;
}

const ASPECT_PRESETS = [
  { label: 'Free', value: 0 },
  { label: 'Original', value: -1 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 },
] as const;

export function ImageCropEditor({
  organizationId,
  mediaId,
  imageUrl,
  width,
  height,
}: ImageCropEditorProps) {
  const { showToast } = useToast();

  // Crop state
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [aspectPreset, setAspectPreset] = useState(0); // index into ASPECT_PRESETS

  // Transform state
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(85);
  const [maxWidth, setMaxWidth] = useState<number | undefined>();

  const originalAspect = width && height ? width / height : 1;
  const selectedPreset = ASPECT_PRESETS[aspectPreset];
  const aspect = selectedPreset.value === -1
    ? originalAspect
    : selectedPreset.value === 0
      ? undefined
      : selectedPreset.value;

  const onCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const hasCrop = croppedAreaPixels &&
    (croppedAreaPixels.x !== 0 ||
     croppedAreaPixels.y !== 0 ||
     croppedAreaPixels.width !== width ||
     croppedAreaPixels.height !== height);

  const hasTransforms = rotation !== 0 || flipH || flipV || hasCrop;

  const handleReset = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCroppedAreaPixels(null);
    setFlipH(false);
    setFlipV(false);
    setAspectPreset(0);
  }, []);

  const transformMutation = useMutation({
    mutationFn: () => {
      const params: TransformParams = {
        rotate: rotation || undefined,
        flip_horizontal: flipH || undefined,
        flip_vertical: flipV || undefined,
        format,
        quality,
        max_width: maxWidth,
      };

      // Include crop if the user has defined a crop region
      if (hasCrop && croppedAreaPixels) {
        params.crop_x = Math.round(croppedAreaPixels.x);
        params.crop_y = Math.round(croppedAreaPixels.y);
        params.crop_width = Math.round(croppedAreaPixels.width);
        params.crop_height = Math.round(croppedAreaPixels.height);
        params.crop_unit = 'pixels';
      }

      return transformImage(organizationId, mediaId, params);
    },
    onSuccess: (result) => {
      const a = document.createElement('a');
      a.href = result.download_url;
      a.download = `transformed.${format}`;
      a.click();
      showToast({ title: 'Transform applied, downloading...', type: 'success' });
    },
    onError: (error: Error) => {
      showToast({ title: `Transform failed: ${error.message}`, type: 'error' });
    },
  });

  return (
    <div className="space-y-4">
      {/* Cropper */}
      <div className="relative rounded-lg overflow-hidden bg-ink/95" style={{ height: 360 }}>
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          showGrid
          onCropChange={setCrop}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          style={{
            containerStyle: { borderRadius: 8 },
          }}
        />
      </div>

      {/* Zoom & Rotation Sliders */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-archive flex items-center gap-1">
              <ZoomIn size={12} />
              Zoom
            </label>
            <span className="text-xs text-archive tabular-nums">{zoom.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-full h-1.5 accent-bark cursor-pointer"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-archive flex items-center gap-1">
              <RotateCw size={12} />
              Rotation
            </label>
            <span className="text-xs text-archive tabular-nums">{rotation}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={rotation}
            onChange={(e) => setRotation(parseInt(e.target.value))}
            className="w-full h-1.5 accent-bark cursor-pointer"
          />
        </div>
      </div>

      {/* Aspect Ratio Presets */}
      <div>
        <label className="text-xs text-archive block mb-1.5">Aspect Ratio</label>
        <div className="flex items-center gap-1.5 flex-wrap">
          {ASPECT_PRESETS.map((preset, i) => (
            <button
              key={preset.label}
              onClick={() => setAspectPreset(i)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                aspectPreset === i
                  ? 'bg-bark text-parchment'
                  : 'border border-lichen hover:bg-stone/20'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transform Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setRotation((r) => (r + 90) % 360)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-lichen rounded hover:bg-stone/20 transition-colors"
          title="Rotate 90° clockwise"
        >
          <RotateCw size={14} />
          +90°
        </button>
        <button
          onClick={() => setRotation((r) => (r + 270) % 360)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-lichen rounded hover:bg-stone/20 transition-colors"
          title="Rotate 90° counter-clockwise"
        >
          <RotateCcw size={14} />
          −90°
        </button>
        <div className="w-px h-5 bg-lichen" />
        <button
          onClick={() => setFlipH(!flipH)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded transition-colors ${
            flipH ? 'border-azurite bg-azurite/10 text-azurite' : 'border-lichen hover:bg-stone/20'
          }`}
        >
          <FlipHorizontal size={14} />
          Flip H
        </button>
        <button
          onClick={() => setFlipV(!flipV)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded transition-colors ${
            flipV ? 'border-azurite bg-azurite/10 text-azurite' : 'border-lichen hover:bg-stone/20'
          }`}
        >
          <FlipVertical size={14} />
          Flip V
        </button>
        {hasTransforms && (
          <>
            <div className="w-px h-5 bg-lichen" />
            <button
              onClick={handleReset}
              className="text-xs text-archive hover:text-ink transition-colors underline"
            >
              Reset all
            </button>
          </>
        )}
      </div>

      {/* Crop Info */}
      {croppedAreaPixels && (
        <div className="flex items-center gap-3 px-3 py-2 bg-stone/20 rounded-lg text-xs text-archive">
          <span>
            Crop: {Math.round(croppedAreaPixels.width)}×{Math.round(croppedAreaPixels.height)}px
          </span>
          <span>
            at ({Math.round(croppedAreaPixels.x)}, {Math.round(croppedAreaPixels.y)})
          </span>
        </div>
      )}

      {/* Output Settings */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-archive block mb-1">Format</label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-lichen rounded bg-parchment"
          >
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
            <option value="tiff">TIFF</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-archive block mb-1">Quality</label>
          <input
            type="number"
            min={1}
            max={100}
            value={quality}
            onChange={(e) => setQuality(parseInt(e.target.value) || 85)}
            className="w-full px-2 py-1.5 text-sm border border-lichen rounded"
          />
        </div>
        <div>
          <label className="text-xs text-archive block mb-1">Max Width</label>
          <input
            type="number"
            min={100}
            value={maxWidth || ''}
            onChange={(e) => setMaxWidth(e.target.value ? parseInt(e.target.value) : undefined)}
            placeholder={String(width)}
            className="w-full px-2 py-1.5 text-sm border border-lichen rounded"
          />
        </div>
      </div>

      {/* Download Button */}
      <button
        onClick={() => transformMutation.mutate()}
        disabled={transformMutation.isPending}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-bark text-parchment rounded-lg hover:bg-bark/90 disabled:opacity-50 transition-colors w-full justify-center"
      >
        {transformMutation.isPending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Download size={16} />
        )}
        Download Transformed Image
      </button>
    </div>
  );
}
