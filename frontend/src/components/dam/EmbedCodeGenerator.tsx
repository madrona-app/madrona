/**
 * EmbedCodeGenerator — generate and copy embed codes for a media item.
 * Shows iframe snippet and direct URL with copy-to-clipboard buttons.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Check, Code, Link, Loader2 } from 'lucide-react';
import { getEmbedCode } from '../../lib/api/media-dam';
import { useToast } from '../../contexts/ToastContext';

interface EmbedCodeGeneratorProps {
  organizationId: string;
  mediaId: string;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast({ title: 'Copied to clipboard', type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ title: 'Failed to copy', type: 'error' });
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-lichen rounded hover:bg-stone/20 transition-colors"
    >
      {copied ? <Check size={12} className="text-semantic-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
      <span className="sr-only"> {label}</span>
    </button>
  );
}

export function EmbedCodeGenerator({
  organizationId,
  mediaId,
}: EmbedCodeGeneratorProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['embed-code', organizationId, mediaId],
    queryFn: () => getEmbedCode(organizationId, mediaId),
    enabled: !!organizationId && !!mediaId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-archive" />
      </div>
    );
  }

  if (!data) return null;

  const { iframe, url } = data.embed_codes;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-archive flex items-center gap-1">
            <Code size={12} aria-hidden="true" />
            Iframe Embed
          </span>
          <CopyButton text={iframe} label="iframe embed code" />
        </div>
        <pre className="p-3 text-xs font-mono bg-stone/20 border border-lichen rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
          {iframe}
        </pre>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-archive flex items-center gap-1">
            <Link size={12} aria-hidden="true" />
            Direct URL
          </span>
          <CopyButton text={url} label="direct URL" />
        </div>
        <pre className="p-3 text-xs font-mono bg-stone/20 border border-lichen rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
          {url}
        </pre>
      </div>
    </div>
  );
}
