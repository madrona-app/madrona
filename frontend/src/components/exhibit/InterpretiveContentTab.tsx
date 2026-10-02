import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  Type,
  Quote,
  Clock,
  Award,
} from 'lucide-react';
import {
  getExhibitionContentBlocks,
  deleteExhibitionContentBlock,
  reorderExhibitionContentBlocks,
  type ExhibitionContentBlock,
  type ContentBlockType,
} from '../../lib/api';
import { ContentBlockEditor } from './ContentBlockEditor';
import ConfirmDialog from '../ConfirmDialog';

interface InterpretiveContentTabProps {
  organizationId: string;
  exhibitionId: string;
  isEditing?: boolean;
}

const BLOCK_TYPE_ICONS: Record<ContentBlockType, typeof FileText> = {
  intro_text: FileText,
  section_header: Type,
  theme_narrative: FileText,
  extended_label: FileText,
  educational_content: FileText,
  multimedia_embed: Eye,
  quote: Quote,
  timeline: Clock,
  credit_panel: Award,
};

const BLOCK_TYPE_LABELS: Record<ContentBlockType, string> = {
  intro_text: 'Introduction',
  section_header: 'Section Header',
  theme_narrative: 'Theme Narrative',
  extended_label: 'Extended Label',
  educational_content: 'Educational',
  multimedia_embed: 'Multimedia',
  quote: 'Quote',
  timeline: 'Timeline',
  credit_panel: 'Credits',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  review: 'bg-semantic-warning/10 text-semantic-warning',
  published: 'bg-semantic-success/10 text-semantic-success',
};

export function InterpretiveContentTab({
  organizationId,
  exhibitionId,
  isEditing = false,
}: InterpretiveContentTabProps) {
  const queryClient = useQueryClient();
  const [showEditor, setShowEditor] = useState(false);
  const [editingBlock, setEditingBlock] = useState<ExhibitionContentBlock | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  // Fetch content blocks
  const { data, isLoading } = useQuery({
    queryKey: ['exhibition-content-blocks', organizationId, exhibitionId],
    queryFn: () => getExhibitionContentBlocks(organizationId, exhibitionId),
    enabled: !!organizationId && !!exhibitionId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (blockId: string) =>
      deleteExhibitionContentBlock(organizationId, exhibitionId, blockId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-content-blocks', organizationId, exhibitionId],
      });
    },
  });

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: (blockIds: string[]) =>
      reorderExhibitionContentBlocks(organizationId, exhibitionId, blockIds),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-content-blocks', organizationId, exhibitionId],
      });
    },
  });

  const blocks = data?.content_blocks || [];

  // Group blocks by section
  const blocksBySection = blocks.reduce(
    (acc, block) => {
      const section = block.section || 'Unsorted';
      if (!acc[section]) {
        acc[section] = [];
      }
      acc[section].push(block);
      return acc;
    },
    {} as Record<string, ExhibitionContentBlock[]>
  );

  const handleDragStart = (blockId: string) => {
    setDraggedId(blockId);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    // Reorder blocks
    const currentIndex = blocks.findIndex((b) => b.block_id === draggedId);
    const targetIndex = blocks.findIndex((b) => b.block_id === targetId);

    if (currentIndex === -1 || targetIndex === -1) return;

    const newBlocks = [...blocks];
    const [removed] = newBlocks.splice(currentIndex, 1);
    newBlocks.splice(targetIndex, 0, removed);

    // Update order immediately for visual feedback
    queryClient.setQueryData(
      ['exhibition-content-blocks', organizationId, exhibitionId],
      { content_blocks: newBlocks }
    );
  };

  const handleDragEnd = () => {
    if (draggedId) {
      // Save the new order
      reorderMutation.mutate(blocks.map((b) => b.block_id));
    }
    setDraggedId(null);
  };

  const handleDelete = (blockId: string) => {
    setConfirmState({
      action: () => deleteMutation.mutate(blockId),
      title: 'Delete Content Block',
      message: 'Are you sure you want to delete this content block?',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-ink">Interpretive Content</h4>
          <p className="text-xs text-archive">
            Wall text, narratives, and educational content for the exhibition
          </p>
        </div>
        {isEditing && (
          <button
            onClick={() => {
              setEditingBlock(null);
              setShowEditor(true);
            }}
            className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
          >
            <Plus size={14} />
            Add Content
          </button>
        )}
      </div>

      {/* Content list */}
      {isLoading ? (
        <div className="text-sm text-archive">Loading content...</div>
      ) : blocks.length === 0 ? (
        <div className="text-sm text-archive italic py-8 text-center border border-dashed border-lichen rounded-lg">
          No interpretive content yet.
          {isEditing && (
            <button
              onClick={() => setShowEditor(true)}
              className="block mx-auto mt-2 text-bark hover:text-copper-dark"
            >
              Add content blocks
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(blocksBySection).map(([section, sectionBlocks]) => (
            <div key={section}>
              <h5 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
                {section}
              </h5>
              <div className="space-y-2">
                {sectionBlocks.map((block) => {
                  const Icon = BLOCK_TYPE_ICONS[block.block_type] || FileText;
                  return (
                    <div
                      key={block.block_id}
                      draggable={isEditing}
                      onDragStart={() => handleDragStart(block.block_id)}
                      onDragOver={(e) => handleDragOver(e, block.block_id)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-start gap-3 p-3 border border-lichen rounded-lg bg-parchment transition-all ${
                        draggedId === block.block_id ? 'opacity-50' : ''
                      } ${isEditing ? 'cursor-move' : ''}`}
                    >
                      {isEditing && (
                        <GripVertical
                          size={14}
                          className="text-archive mt-0.5 cursor-move shrink-0"
                        />
                      )}
                      <Icon size={16} className="text-archive mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">
                              {block.title || BLOCK_TYPE_LABELS[block.block_type]}
                            </p>
                            <p className="text-xs text-archive line-clamp-2">
                              {block.content.substring(0, 150)}
                              {block.content.length > 150 ? '...' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                STATUS_STYLES[block.status] || STATUS_STYLES.draft
                              }`}
                            >
                              {block.status}
                            </span>
                            {block.is_public ? (
                              <span title="Public"><Eye size={12} className="text-semantic-success" /></span>
                            ) : (
                              <span title="Private"><EyeOff size={12} className="text-archive" /></span>
                            )}
                          </div>
                        </div>
                        {isEditing && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => {
                                setEditingBlock(block);
                                setShowEditor(true);
                              }}
                              className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark"
                            >
                              <Edit size={12} />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(block.block_id)}
                              disabled={deleteMutation.isPending}
                              className="flex items-center gap-1 text-xs text-semantic-error hover:text-semantic-error/80 disabled:opacity-50"
                            >
                              <Trash2 size={12} />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />

      {/* Content Editor */}
      <ContentBlockEditor
        isOpen={showEditor}
        organizationId={organizationId}
        exhibitionId={exhibitionId}
        block={editingBlock}
        onClose={() => {
          setShowEditor(false);
          setEditingBlock(null);
        }}
        onSuccess={() => {
          setShowEditor(false);
          setEditingBlock(null);
        }}
      />
    </div>
  );
}

export default InterpretiveContentTab;
