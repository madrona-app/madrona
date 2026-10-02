import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listRecordComments,
  createRecordComment,
  getRecordWatchStatus,
  watchRecord,
  unwatchRecord,
  type DiscussionEntityType,
  type RecordComment,
} from '../lib/api';
import { formatDateShort, formatTime } from '../lib/formatters';

// ============================================================================
// Comment Card Component
// ============================================================================

interface CommentCardProps {
  comment: RecordComment;
}

function CommentCard({ comment }: CommentCardProps) {
  const authorName = comment.author.display_name || comment.author.email || 'Unknown';
  const isSystemComment = comment.kind === 'system';

  return (
    <div className={`${isSystemComment ? 'bg-stone/30 border-lichen' : 'bg-parchment border-lichen'} border rounded-lg p-4`}>
      {/* Author and timestamp */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{authorName}</span>
          {isSystemComment && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-stone text-archive">
              System
            </span>
          )}
        </div>
        <span className="text-xs text-archive">
          {formatDateShort(comment.created_at)} · {formatTime(comment.created_at)}
        </span>
      </div>

      {/* Comment content */}
      <div className="text-sm text-ink whitespace-pre-wrap">
        {comment.content}
      </div>
    </div>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState() {
  return (
    <div className="text-center py-12">
      <svg
        className="mx-auto h-12 w-12 text-archive"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <h3 className="mt-2 text-sm font-medium text-ink">No notes yet</h3>
      <p className="mt-1 text-sm text-archive">
        Add the first note to this record.
      </p>
    </div>
  );
}

// ============================================================================
// Loading State Component
// ============================================================================

function LoadingState() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-parchment border border-lichen rounded-lg p-4 animate-pulse">
          <div className="flex items-center justify-between mb-2">
            <div className="w-32 h-4 bg-stone rounded" />
            <div className="w-24 h-3 bg-stone rounded" />
          </div>
          <div className="space-y-2">
            <div className="w-full h-3 bg-stone rounded" />
            <div className="w-3/4 h-3 bg-stone rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Watch Toggle Component
// ============================================================================

interface WatchToggleProps {
  organizationId: string;
  entityType: DiscussionEntityType;
  entityId: string;
}

function WatchToggle({ organizationId, entityType, entityId }: WatchToggleProps) {
  const queryClient = useQueryClient();

  const { data: watchStatus, isLoading } = useQuery({
    queryKey: ['recordWatch', organizationId, entityType, entityId],
    queryFn: () => getRecordWatchStatus(organizationId, entityType, entityId),
  });

  const watchMutation = useMutation({
    mutationFn: () => watchRecord(organizationId, entityType, entityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordWatch', organizationId, entityType, entityId] });
    },
  });

  const unwatchMutation = useMutation({
    mutationFn: () => unwatchRecord(organizationId, entityType, entityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordWatch', organizationId, entityType, entityId] });
    },
  });

  const isWatching = watchStatus?.watching ?? false;
  const isPending = watchMutation.isPending || unwatchMutation.isPending;

  const handleToggle = () => {
    if (isWatching) {
      unwatchMutation.mutate();
    } else {
      watchMutation.mutate();
    }
  };

  if (isLoading) {
    return <div className="w-16 h-5 bg-stone rounded animate-pulse" />;
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        isWatching
          ? 'bg-copper/10 text-copper hover:bg-copper-dark/20'
          : 'bg-stone text-archive hover:bg-stone/80'
      } disabled:opacity-50`}
    >
      {isWatching ? (
        <>
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
          Watching
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Watch
        </>
      )}
    </button>
  );
}

// ============================================================================
// Comment Input Component
// ============================================================================

interface CommentInputProps {
  organizationId: string;
  entityType: DiscussionEntityType;
  entityId: string;
  onCommentAdded: () => void;
}

function CommentInput({ organizationId, entityType, entityId, onCommentAdded }: CommentInputProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mutation = useMutation({
    mutationFn: () => createRecordComment(organizationId, entityType, entityId, content.trim()),
    onSuccess: () => {
      setContent('');
      onCommentAdded();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim() && !mutation.isPending) {
      mutation.mutate();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to submit
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      <div className="border border-lichen rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-bark/30 focus-within:border-bark">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Add a note..."
          rows={3}
          className="block w-full px-3 py-2 text-sm resize-none border-0 focus-visible:ring-0 focus-visible:outline-none"
          disabled={mutation.isPending}
        />
        <div className="flex items-center justify-between px-3 py-2 bg-stone/30 border-t border-lichen">
          <span className="text-xs text-archive">
            Press <kbd className="px-1 py-0.5 bg-parchment rounded text-xs border border-lichen">⌘</kbd>+<kbd className="px-1 py-0.5 bg-parchment rounded text-xs border border-lichen">Enter</kbd> to submit
          </span>
          <button
            type="submit"
            disabled={!content.trim() || mutation.isPending}
            className="px-4 py-1.5 text-sm font-medium text-parchment bg-bark rounded-md hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Adding...' : 'Add Note'}
          </button>
        </div>
      </div>
      {mutation.isError && (
        <p className="mt-2 text-sm text-semantic-error">
          Failed to add note. Please try again.
        </p>
      )}
    </form>
  );
}

// ============================================================================
// Main RecordDiscussionTab Component
// ============================================================================

interface RecordDiscussionTabProps {
  entityType: DiscussionEntityType;
  entityId: string;
  organizationId: string;
}

export function RecordDiscussionTab({
  entityType,
  entityId,
  organizationId,
}: RecordDiscussionTabProps) {
  const queryClient = useQueryClient();
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['recordComments', organizationId, entityType, entityId],
    queryFn: () => listRecordComments(organizationId, entityType, entityId, { limit: 200 }),
  });

  const comments = data?.items || [];
  const totalCount = data?.total || 0;

  // Scroll to bottom when new comments are added
  const scrollToBottom = () => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCommentAdded = () => {
    queryClient.invalidateQueries({ queryKey: ['recordComments', organizationId, entityType, entityId] });
    // Scroll after a small delay to allow for re-render
    setTimeout(scrollToBottom, 100);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-lg font-medium text-ink">Record Notes</h3>
            <p className="text-sm text-archive">Notes visible to all staff on this record</p>
          </div>
        </div>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-lg font-medium text-ink">Record Notes</h3>
            <p className="text-sm text-archive">Notes visible to all staff on this record</p>
          </div>
        </div>
        <div className="text-center py-12">
          <div className="text-semantic-error mb-2">Failed to load discussion</div>
          <div className="text-sm text-archive">{(error as Error)?.message || 'Unknown error'}</div>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 text-sm bg-parchment border border-lichen rounded-md text-ink hover:bg-stone/30"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-medium text-ink">Record Notes</h3>
          <p className="text-sm text-archive">
            {totalCount > 0
              ? `${totalCount} note${totalCount !== 1 ? 's' : ''} on this record`
              : 'Notes visible to all staff on this record'}
          </p>
        </div>
        <WatchToggle
          organizationId={organizationId}
          entityType={entityType}
          entityId={entityId}
        />
      </div>

      {/* Comments list */}
      {comments.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {comments.map((comment) => (
            <CommentCard key={comment.comment_id} comment={comment} />
          ))}
          <div ref={commentsEndRef} />
        </div>
      )}

      {/* Info note */}
      <p className="text-xs text-archive mt-2 mb-1">
        Notes are permanent and part of the audit trail.
      </p>

      {/* Comment input */}
      <CommentInput
        organizationId={organizationId}
        entityType={entityType}
        entityId={entityId}
        onCommentAdded={handleCommentAdded}
      />
    </div>
  );
}

export default RecordDiscussionTab;
