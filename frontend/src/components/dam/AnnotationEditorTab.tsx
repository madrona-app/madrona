/**
 * AnnotationEditorTab — W3C Web Annotation overlay for images.
 * Displays existing annotations as rectangles on the image and allows
 * creating new ones by click-and-drag.
 */
import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Loader2,
  Tag,
  Eye,
  MousePointerSquareDashed,
} from 'lucide-react';
import {
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from '../../lib/api/media-dam';
import type { MediaAnnotation } from '../../lib/api/media-dam';
import { useToast } from '../../contexts/ToastContext';
import { formatDateTime } from '@/lib/formatters';

interface AnnotationEditorTabProps {
  organizationId: string;
  mediaId: string;
  imageUrl?: string | null;
  mediaType: string;
}

interface AnnotationRect {
  x: number; // percent
  y: number;
  w: number;
  h: number;
}

const MOTIVATION_OPTIONS = [
  { value: 'commenting', label: 'Comment' },
  { value: 'describing', label: 'Description' },
  { value: 'tagging', label: 'Tag' },
  { value: 'identifying', label: 'Identification' },
];

function parseFragmentSelector(selector: Record<string, unknown>): AnnotationRect | null {
  // W3C Fragment Selector: { type: "FragmentSelector", value: "xywh=percent:x,y,w,h" }
  const value = selector?.value as string;
  if (!value) return null;
  const match = value.match(/xywh=(?:percent:)?(\d+\.?\d*),(\d+\.?\d*),(\d+\.?\d*),(\d+\.?\d*)/);
  if (!match) return null;
  return {
    x: parseFloat(match[1]),
    y: parseFloat(match[2]),
    w: parseFloat(match[3]),
    h: parseFloat(match[4]),
  };
}

function toFragmentSelector(rect: AnnotationRect): Record<string, unknown> {
  return {
    type: 'FragmentSelector',
    value: `xywh=percent:${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.w.toFixed(1)},${rect.h.toFixed(1)}`,
  };
}

export function AnnotationEditorTab({
  organizationId,
  mediaId,
  imageUrl,
  mediaType,
}: AnnotationEditorTabProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRect, setNewRect] = useState<AnnotationRect | null>(null);
  const [formBody, setFormBody] = useState('');
  const [formMotivation, setFormMotivation] = useState('commenting');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const isImage = mediaType === 'image';

  // Fetch annotations
  const { data, isLoading } = useQuery({
    queryKey: ['media-annotations', organizationId, mediaId],
    queryFn: () => getAnnotations(organizationId, mediaId),
    enabled: !!organizationId && !!mediaId,
  });

  const annotations = data?.annotations || [];

  // Create mutation
  const createMut = useMutation({
    mutationFn: (params: {
      target_selector: Record<string, unknown>;
      body?: Record<string, unknown>;
      motivation?: string;
    }) => createAnnotation(organizationId, mediaId, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-annotations', organizationId, mediaId] });
      resetDrawing();
      showToast({ title: 'Annotation added', type: 'success' });
    },
  });

  // Update mutation
  const updateMut = useMutation({
    mutationFn: ({ annotationId, body }: { annotationId: string; body: string }) =>
      updateAnnotation(organizationId, mediaId, annotationId, {
        body: { type: 'TextualBody', value: body, format: 'text/plain' },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-annotations', organizationId, mediaId] });
      setEditingId(null);
      showToast({ title: 'Annotation updated', type: 'success' });
    },
  });

  // Delete mutation
  const deleteMut = useMutation({
    mutationFn: (annotationId: string) =>
      deleteAnnotation(organizationId, mediaId, annotationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-annotations', organizationId, mediaId] });
      setSelectedAnnotation(null);
      showToast({ title: 'Annotation deleted', type: 'success' });
    },
  });

  const resetDrawing = () => {
    setIsDrawing(false);
    setDrawStart(null);
    setDrawCurrent(null);
    setShowCreateForm(false);
    setNewRect(null);
    setFormBody('');
    setFormMotivation('commenting');
  };

  const getMousePercent = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    if (!imageContainerRef.current) return null;
    const rect = imageContainerRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isDrawing) return;
    const pos = getMousePercent(e);
    if (pos) {
      setDrawStart(pos);
      setDrawCurrent(pos);
    }
  }, [isDrawing, getMousePercent]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !drawStart) return;
    const pos = getMousePercent(e);
    if (pos) setDrawCurrent(pos);
  }, [isDrawing, drawStart, getMousePercent]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !drawStart || !drawCurrent) return;
    const rect: AnnotationRect = {
      x: Math.min(drawStart.x, drawCurrent.x),
      y: Math.min(drawStart.y, drawCurrent.y),
      w: Math.abs(drawCurrent.x - drawStart.x),
      h: Math.abs(drawCurrent.y - drawStart.y),
    };
    // Minimum 2% size to avoid accidental clicks
    if (rect.w < 2 || rect.h < 2) {
      setDrawStart(null);
      setDrawCurrent(null);
      return;
    }
    setNewRect(rect);
    setShowCreateForm(true);
    setDrawStart(null);
    setDrawCurrent(null);
  }, [isDrawing, drawStart, drawCurrent]);

  const handleCreateSubmit = () => {
    if (!newRect) return;
    createMut.mutate({
      target_selector: toFragmentSelector(newRect),
      body: formBody
        ? { type: 'TextualBody', value: formBody, format: 'text/plain' }
        : undefined,
      motivation: formMotivation,
    });
  };

  const getBodyText = (ann: MediaAnnotation): string => {
    const body = ann.body as { value?: string } | null;
    return body?.value || '';
  };

  // Drawing rectangle for live preview
  const drawingRect = drawStart && drawCurrent
    ? {
        x: Math.min(drawStart.x, drawCurrent.x),
        y: Math.min(drawStart.y, drawCurrent.y),
        w: Math.abs(drawCurrent.x - drawStart.x),
        h: Math.abs(drawCurrent.y - drawStart.y),
      }
    : null;

  if (!isImage || !imageUrl) {
    return (
      <div className="text-sm text-archive py-8 text-center">
        <MousePointerSquareDashed size={24} className="mx-auto mb-2 opacity-50" />
        <p>Annotations are only available for image files.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-archive" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MousePointerSquareDashed size={16} className="text-archive" />
          <h3 className="text-sm font-medium text-ink">
            Annotations ({annotations.length})
          </h3>
        </div>
        <button
          onClick={() => {
            if (isDrawing) {
              resetDrawing();
            } else {
              setIsDrawing(true);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            isDrawing
              ? 'bg-bark text-parchment'
              : 'border border-lichen text-ink hover:bg-stone/20'
          }`}
        >
          {isDrawing ? (
            <>
              <X size={14} />
              Cancel Drawing
            </>
          ) : (
            <>
              <Plus size={14} />
              Add Annotation
            </>
          )}
        </button>
      </div>

      {isDrawing && !showCreateForm && (
        <div className="p-2 bg-bark/10 border border-bark/20 rounded-lg text-xs text-bark text-center">
          Click and drag on the image to select a region
        </div>
      )}

      {/* Image with overlays */}
      <div
        ref={imageContainerRef}
        className={`relative select-none overflow-hidden rounded-lg border border-lichen ${
          isDrawing ? 'cursor-crosshair' : ''
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <img
          src={imageUrl}
          alt="Media for annotation"
          className="w-full block"
          draggable={false}
        />

        {/* Existing annotation rectangles */}
        {annotations.map((ann) => {
          const rect = parseFragmentSelector(ann.target_selector);
          if (!rect) return null;
          const isSelected = selectedAnnotation === ann.annotation_id;
          return (
            <div
              key={ann.annotation_id}
              role="button"
              tabIndex={0}
              className={`absolute border-2 transition-colors cursor-pointer ${
                isSelected
                  ? 'border-bark bg-bark/20'
                  : 'border-bark/50 bg-bark/10 hover:border-bark hover:bg-bark/20'
              } focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2`}
              style={{
                left: `${rect.x}%`,
                top: `${rect.y}%`,
                width: `${rect.w}%`,
                height: `${rect.h}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedAnnotation(isSelected ? null : ann.annotation_id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedAnnotation(isSelected ? null : ann.annotation_id);
                }
              }}
              title={getBodyText(ann) || ann.motivation || 'Annotation'}
              aria-label={`Annotation: ${getBodyText(ann) || ann.motivation || 'Annotation'}`}
            />
          );
        })}

        {/* Drawing preview rectangle */}
        {drawingRect && (
          <div
            className="absolute border-2 border-dashed border-bark bg-bark/15 pointer-events-none"
            style={{
              left: `${drawingRect.x}%`,
              top: `${drawingRect.y}%`,
              width: `${drawingRect.w}%`,
              height: `${drawingRect.h}%`,
            }}
          />
        )}

        {/* New annotation preview */}
        {newRect && showCreateForm && (
          <div
            className="absolute border-2 border-bark bg-bark/20 pointer-events-none"
            style={{
              left: `${newRect.x}%`,
              top: `${newRect.y}%`,
              width: `${newRect.w}%`,
              height: `${newRect.h}%`,
            }}
          />
        )}
      </div>

      {/* Create annotation form */}
      {showCreateForm && newRect && (
        <div className="card p-4 border-2 border-bark/20 space-y-3">
          <h4 className="text-sm font-medium">New Annotation</h4>
          <div>
            <label className="block text-xs text-archive mb-1">Motivation</label>
            <select
              value={formMotivation}
              onChange={(e) => setFormMotivation(e.target.value)}
              className="input w-full text-sm"
            >
              {MOTIVATION_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-archive mb-1">Note</label>
            <textarea
              value={formBody}
              onChange={(e) => setFormBody(e.target.value)}
              placeholder="Describe this region..."
              className="input w-full text-sm"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetDrawing} className="btn btn-secondary text-sm">
              Cancel
            </button>
            <button
              onClick={handleCreateSubmit}
              disabled={createMut.isPending}
              className="btn btn-primary text-sm flex items-center gap-1"
            >
              {createMut.isPending && <Loader2 size={14} className="animate-spin" />}
              Save Annotation
            </button>
          </div>
        </div>
      )}

      {/* Annotations list */}
      {annotations.length > 0 && (
        <div className="space-y-2">
          {annotations.map((ann) => {
            const bodyText = getBodyText(ann);
            const isSelected = selectedAnnotation === ann.annotation_id;
            const isEditingThis = editingId === ann.annotation_id;
            const motivationLabel = MOTIVATION_OPTIONS.find(
              (m) => m.value === ann.motivation
            )?.label || ann.motivation || 'Comment';

            return (
              <div
                key={ann.annotation_id}
                className={`p-3 border rounded-lg transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-bark bg-bark/5'
                    : 'border-lichen hover:border-stone'
                }`}
                onClick={() => setSelectedAnnotation(isSelected ? null : ann.annotation_id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {ann.motivation === 'tagging' ? (
                      <Tag size={14} className="text-bark flex-shrink-0" />
                    ) : ann.motivation === 'describing' ? (
                      <Eye size={14} className="text-bark flex-shrink-0" />
                    ) : (
                      <MessageSquare size={14} className="text-bark flex-shrink-0" />
                    )}
                    <span className="text-xs bg-stone/30 text-archive px-1.5 py-0.5 rounded">
                      {motivationLabel}
                    </span>
                  </div>

                  {isSelected && (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingId(ann.annotation_id);
                          setEditBody(bodyText);
                        }}
                        className="p-1 hover:bg-stone/30 rounded text-archive hover:text-ink"
                        title="Edit"
                        aria-label="Edit annotation"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={() => deleteMut.mutate(ann.annotation_id)}
                        disabled={deleteMut.isPending}
                        className="p-1 hover:bg-semantic-error/10 rounded text-archive hover:text-semantic-error"
                        title="Delete"
                        aria-label="Delete annotation"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>

                {isEditingThis ? (
                  <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="input w-full text-sm"
                      rows={2}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="text-xs text-archive hover:text-ink">
                        Cancel
                      </button>
                      <button
                        onClick={() => updateMut.mutate({ annotationId: ann.annotation_id, body: editBody })}
                        disabled={updateMut.isPending}
                        className="flex items-center gap-1 text-xs font-medium text-bark hover:text-bark/80"
                      >
                        <Save size={12} />
                        Save
                      </button>
                    </div>
                  </div>
                ) : bodyText ? (
                  <p className="text-sm text-ink mt-1.5 line-clamp-2">{bodyText}</p>
                ) : null}

                {ann.created_at && (
                  <p className="text-[10px] text-archive mt-1">
                    {formatDateTime(ann.created_at)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {annotations.length === 0 && !isDrawing && (
        <div className="py-6 text-center text-sm text-archive">
          <MousePointerSquareDashed size={28} className="mx-auto mb-2 opacity-30" />
          <p>No annotations yet.</p>
          <p className="text-xs mt-1">
            Click &ldquo;Add Annotation&rdquo; then draw a rectangle on the image.
          </p>
        </div>
      )}
    </div>
  );
}
