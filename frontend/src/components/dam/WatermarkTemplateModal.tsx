import { useState } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Type, Image } from 'lucide-react';
import { createWatermarkTemplate, uploadMedia } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface WatermarkTemplateModalProps {
  organizationId: string;
  onClose: () => void;
}

type WatermarkType = 'text' | 'image';
type Position = 'top-left' | 'top-center' | 'top-right' | 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right';

const POSITIONS: { value: Position; label: string }[] = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'center', label: 'Center' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-right', label: 'Bottom Right' },
];

export function WatermarkTemplateModal({
  organizationId,
  onClose,
}: WatermarkTemplateModalProps) {
  const queryClient = useQueryClient();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'watermark-template-modal',
  });

  const [name, setName] = useState('');
  const [watermarkType, setWatermarkType] = useState<WatermarkType>('text');
  const [isDefault, setIsDefault] = useState(false);

  // Text watermark config
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(24);
  const [fontColor, setFontColor] = useState('rgb(var(--color-parchment-warm))');
  const [opacity, setOpacity] = useState(0.5);
  const [position, setPosition] = useState<Position>('bottom-right');

  // Image watermark config
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [scale, setScale] = useState(0.2);

  const createMutation = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {
        opacity,
        position,
      };

      if (watermarkType === 'text') {
        config.text = text;
        config.font_size = fontSize;
        config.font_color = fontColor;
      } else {
        config.scale = scale;
        if (imageFile) {
          const media = await uploadMedia(organizationId, imageFile, {
            title: `Watermark: ${name}`,
            folder: 'watermarks',
          });
          config.image_s3_key = media.s3_key;
          config.media_id = media.media_id;
        }
      }

      return createWatermarkTemplate(organizationId, {
        name,
        watermark_type: watermarkType,
        config,
        is_default: isDefault,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watermark-templates', organizationId] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  const isValid = name.trim() && (watermarkType === 'text' ? text.trim() : true);

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-lichen">
          <h2 id={titleId} className="text-lg font-semibold text-ink">Create Watermark Template</h2>
        </div>

        <form id="watermark-form" onSubmit={handleSubmit} className="p-6 space-y-4">
          <p id={descriptionId} className="sr-only">
            Create a new watermark template for your media
          </p>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Template Name <span className="text-semantic-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              placeholder="e.g., Copyright Notice"
              required
            />
          </div>

          {/* Watermark Type */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Watermark Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setWatermarkType('text')}
                className={`p-4 rounded-sm border-2 flex flex-col items-center gap-2 transition-colors ${
                  watermarkType === 'text'
                    ? 'border-bark bg-bark/5'
                    : 'border-lichen hover:border-archive'
                }`}
              >
                <Type className={`h-6 w-6 ${watermarkType === 'text' ? 'text-bark' : 'text-archive'}`} />
                <span className="text-sm font-medium text-ink">Text</span>
              </button>
              <button
                type="button"
                onClick={() => setWatermarkType('image')}
                className={`p-4 rounded-sm border-2 flex flex-col items-center gap-2 transition-colors ${
                  watermarkType === 'image'
                    ? 'border-bark bg-bark/5'
                    : 'border-lichen hover:border-archive'
                }`}
              >
                <Image className={`h-6 w-6 ${watermarkType === 'image' ? 'text-bark' : 'text-archive'}`} />
                <span className="text-sm font-medium text-ink">Image</span>
              </button>
            </div>
          </div>

          {/* Text Watermark Config */}
          {watermarkType === 'text' && (
            <div className="space-y-4 p-4 bg-stone/30 rounded-sm border border-lichen">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Watermark Text <span className="text-semantic-error">*</span>
                </label>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="e.g., (c) 2024 Organization Name"
                  required={watermarkType === 'text'}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Font Size</label>
                  <input
                    type="number"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    min={8}
                    max={72}
                    className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Font Color</label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={fontColor}
                      onChange={(e) => setFontColor(e.target.value)}
                      className="w-10 h-10 rounded border border-lichen cursor-pointer"
                    />
                    <input
                      type="text"
                      value={fontColor}
                      onChange={(e) => setFontColor(e.target.value)}
                      className="flex-1 px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                      placeholder="#ffffff"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Image Watermark Config */}
          {watermarkType === 'image' && (
            <div className="space-y-4 p-4 bg-stone/30 rounded-sm border border-lichen">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Watermark Image</label>
                <div className="border-2 border-dashed border-lichen rounded-sm p-6 text-center bg-parchment">
                  {imageFile ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-ink">{imageFile.name}</p>
                      <button
                        type="button"
                        onClick={() => setImageFile(null)}
                        className="text-sm text-semantic-error hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <>
                      <Image className="h-8 w-8 mx-auto text-archive mb-2" />
                      <p className="text-sm text-archive mb-2">
                        Upload a PNG or SVG with transparency
                      </p>
                      <input
                        type="file"
                        accept="image/png,image/svg+xml"
                        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                        className="hidden"
                        id="watermark-image"
                      />
                      <label
                        htmlFor="watermark-image"
                        className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink cursor-pointer inline-block hover:bg-stone/20 transition-colors"
                      >
                        Select Image
                      </label>
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Scale ({Math.round(scale * 100)}%)
                </label>
                <input
                  type="range"
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  className="w-full accent-bark"
                />
                <p className="text-xs text-archive mt-1">
                  Relative size of the watermark compared to the image
                </p>
              </div>
            </div>
          )}

          {/* Common Config */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Position</label>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value as Position)}
                className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {POSITIONS.map((pos) => (
                  <option key={pos.value} value={pos.value}>
                    {pos.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Opacity ({Math.round(opacity * 100)}%)
              </label>
              <input
                type="range"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                min={0.1}
                max={1}
                step={0.05}
                className="w-full accent-bark"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="is-default"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              <label htmlFor="is-default" className="text-sm text-ink">
                Set as default watermark template
              </label>
            </div>
          </div>

          {/* Error */}
          {createMutation.isError && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
              {(createMutation.error as Error)?.message || 'Failed to create template'}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="watermark-form"
            disabled={!isValid || createMutation.isPending}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {createMutation.isPending && <Loader2 size={16} className="animate-spin" />}
            Create Template
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
