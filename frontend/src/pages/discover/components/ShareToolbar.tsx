import { useState, useCallback } from 'react';
import { Link2, Check, Mail } from 'lucide-react';

interface ShareToolbarProps {
  url: string;
  title: string;
  variant?: 'light' | 'dark';
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export function ShareToolbar({ url, title, variant = 'light' }: ShareToolbarProps) {
  const [copied, setCopied] = useState(false);

  const fullUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = fullUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [fullUrl]);

  const shareOnX = useCallback(() => {
    const params = new URLSearchParams({ text: title, url: fullUrl });
    window.open(`https://x.com/intent/tweet?${params.toString()}`, '_blank', 'noopener');
  }, [title, fullUrl]);

  const shareOnFacebook = useCallback(() => {
    const params = new URLSearchParams({ u: fullUrl });
    window.open(`https://www.facebook.com/sharer/sharer.php?${params.toString()}`, '_blank', 'noopener');
  }, [fullUrl]);

  const shareViaEmail = useCallback(() => {
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(`${title}\n\n${fullUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }, [title, fullUrl]);

  const btnClass = variant === 'dark'
    ? "p-1.5 text-parchment/60 hover:text-parchment transition-colors rounded"
    : "p-1.5 text-archive hover:text-bark transition-colors rounded";

  return (
    <div className="flex items-center gap-1">
      <button onClick={handleCopy} className={btnClass} title="Copy link" aria-label="Copy link">
        {copied ? <Check size={16} /> : <Link2 size={16} />}
      </button>
      <button onClick={shareOnX} className={btnClass} title="Share on X" aria-label="Share on X">
        <XIcon size={14} />
      </button>
      <button onClick={shareOnFacebook} className={btnClass} title="Share on Facebook" aria-label="Share on Facebook">
        <FacebookIcon size={14} />
      </button>
      <button onClick={shareViaEmail} className={btnClass} title="Share via email" aria-label="Share via email">
        <Mail size={16} />
      </button>
    </div>
  );
}
