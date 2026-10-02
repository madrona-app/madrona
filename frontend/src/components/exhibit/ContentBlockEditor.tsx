import { useState, useEffect } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  createExhibitionContentBlock,
  updateExhibitionContentBlock,
  type ExhibitionContentBlock,
  type ContentBlockType,
} from '../../lib/api';
import SlideOver from '../ui/SlideOver';

interface ContentBlockEditorProps {
  isOpen: boolean;
  organizationId: string;
  exhibitionId: string;
  block?: ExhibitionContentBlock | null;
  onClose: () => void;
  onSuccess: () => void;
}

const BLOCK_TYPES: { value: ContentBlockType; label: string; description: string }[] = [
  { value: 'intro_text', label: 'Introduction', description: 'Exhibition introduction text' },
  { value: 'section_header', label: 'Section Header', description: 'Section divider or header' },
  { value: 'theme_narrative', label: 'Theme Narrative', description: 'Thematic essay or narrative' },
  { value: 'extended_label', label: 'Extended Label', description: 'Extended object interpretation' },
  { value: 'educational_content', label: 'Educational', description: 'Educational material' },
  { value: 'multimedia_embed', label: 'Multimedia', description: 'Video or audio embed' },
  { value: 'quote', label: 'Quote', description: 'Highlighted quotation' },
  { value: 'timeline', label: 'Timeline', description: 'Timeline entry' },
  { value: 'credit_panel', label: 'Credits', description: 'Acknowledgments and credits' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'Under Review' },
  { value: 'published', label: 'Published' },
];

export function ContentBlockEditor({
  isOpen,
  organizationId,
  exhibitionId,
  block,
  onClose,
  onSuccess,
}: ContentBlockEditorProps) {
  const queryClient = useQueryClient();
  const isEditMode = !!block;

  // Form state
  const [blockType, setBlockType] = useState<ContentBlockType>(block?.block_type || 'intro_text');
  const [section, setSection] = useState(block?.section || '');
  const [title, setTitle] = useState(block?.title || '');
  const [content, setContent] = useState(block?.content || '');
  const [contentFormat, setContentFormat] = useState(block?.content_format || 'markdown');
  const [status, setStatus] = useState(block?.status || 'draft');
  const [isPublic, setIsPublic] = useState(block?.is_public || false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when block changes
  useEffect(() => {
    if (block) {
      setBlockType(block.block_type);
      setSection(block.section || '');
      setTitle(block.title || '');
      setContent(block.content);
      setContentFormat(block.content_format);
      setStatus(block.status);
      setIsPublic(block.is_public);
    } else {
      setBlockType('intro_text');
      setSection('');
      setTitle('');
      setContent('');
      setContentFormat('markdown');
      setStatus('draft');
      setIsPublic(false);
    }
  }, [block]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: () =>
      createExhibitionContentBlock(organizationId, exhibitionId, {
        block_type: blockType,
        section: section || undefined,
        title: title || undefined,
        content,
        content_format: contentFormat as ExhibitionContentBlock['content_format'],
        status: status as ExhibitionContentBlock['status'],
        is_public: isPublic,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-content-blocks', organizationId, exhibitionId],
      });
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateExhibitionContentBlock(organizationId, exhibitionId, block!.block_id, {
        block_type: blockType,
        section: section || undefined,
        title: title || undefined,
        content,
        content_format: contentFormat as ExhibitionContentBlock['content_format'],
        status: status as ExhibitionContentBlock['status'],
        is_public: isPublic,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['exhibition-content-blocks', organizationId, exhibitionId],
      });
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    setError(null);
    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    if (isEditMode) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Content Block' : 'Add Content Block'}
      subtitle="Create interpretive content for the exhibition"
      width="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : isEditMode ? (
              'Save Changes'
            ) : (
              'Add Block'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Block type */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Block Type
          </label>
          <select
            value={blockType}
            onChange={(e) => setBlockType(e.target.value as ContentBlockType)}
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          >
            {BLOCK_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label} - {type.description}
              </option>
            ))}
          </select>
        </div>

        {/* Section and Title */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Section
            </label>
            <input
              type="text"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="e.g., Gallery A, Introduction"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Block title (optional)"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        {/* Content */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-ink">
              Content <span className="text-semantic-error">*</span>
            </label>
            <select
              value={contentFormat}
              onChange={(e) => setContentFormat(e.target.value as 'markdown' | 'html' | 'plain')}
              className="px-2 py-1 text-xs border border-lichen rounded focus-visible:outline-none"
            >
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
              <option value="plain">Plain Text</option>
            </select>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder={
              contentFormat === 'markdown'
                ? 'Write your content using Markdown formatting...\n\n# Heading\n**Bold** and *italic* text...'
                : 'Enter your content...'
            }
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark font-mono resize-none"
          />
          {contentFormat === 'markdown' && (
            <p className="mt-1 text-xs text-archive">
              Supports Markdown: # headings, **bold**, *italic*, - lists, [links](url)
            </p>
          )}
        </div>

        {/* Status and Public */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'review' | 'published')}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <Checkbox
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Include in public gallery
            </label>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

export default ContentBlockEditor;
