import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, FileText } from 'lucide-react';
import type { DiscoverMediaItem } from '../../../types/discover';
import { getDiscoverDocumentText } from '../../../lib/api/discover';
import { formatFileSize } from '../../../lib/utils';
import { documentTypeLabel, formatDuration, resolvePublicApiUrl } from './publicMedia';

/**
 * Audio, video and documents on a public record page.
 *
 * Native <audio>/<video controls> only — the browser's own controls are the
 * ones JAWS and VoiceOver already know. Nothing autoplays. Captions arrive
 * as <track kind="captions"> from the Discover API (same origin, so no CORS
 * attribute is needed). A transcript, where one exists, sits behind a real
 * disclosure button. Documents are a named link stating type and size; no
 * inline PDF frame, because browser PDF viewers can capture keyboard focus.
 *
 * What plays or opens is an access copy unless the file's download level
 * allows the original (the API decides; `url` is null when nothing may be
 * served yet). A PDF's access copy is page images with no text layer, so the
 * document's text is offered first, as HTML with a heading per page.
 */

const LINK_CLASS =
  'text-bark hover:text-copper-dark underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

const DISCLOSURE_CLASS =
  'inline-flex items-center gap-1 min-h-[44px] px-2 -mx-2 text-sm font-medium text-bark hover:text-copper-dark rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

function TranscriptDisclosure({ item }: { item: DiscoverMediaItem }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!item.transcript) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={DISCLOSURE_CLASS}
      >
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        Transcript<span className="sr-only">: {item.name}</span>
      </button>
      <div id={panelId} hidden={!open} className="mt-2 p-3 bg-stone/20 rounded border border-lichen">
        {item.transcript_machine_generated && (
          <p className="text-xs text-archive mb-2">This transcript was generated automatically and may contain errors.</p>
        )}
        <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{item.transcript}</p>
      </div>
    </div>
  );
}

/** The document's text as HTML: one section and heading per page for PDFs. */
function DocumentTextView({ item }: { item: DiscoverMediaItem }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = item.name || 'this document';
  const textUrl = item.text_url || '';
  const { data, isLoading, isError } = useQuery({
    queryKey: ['discover-document-text', textUrl],
    queryFn: () => getDiscoverDocumentText(textUrl),
    enabled: open && !!textUrl,
    staleTime: 5 * 60 * 1000,
  });
  if (!textUrl) return null;
  const pages = data?.pages || [];
  const paged = pages.some((p) => p.page != null);

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={DISCLOSURE_CLASS}
      >
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        Read the text{' '}<span className="sr-only">of {name}</span>
      </button>
      <div id={panelId} hidden={!open} className="mt-2 p-3 bg-stone/20 rounded border border-lichen">
        {isLoading && <p role="status" className="text-sm text-archive">Loading the text…</p>}
        {isError && <p role="status" className="text-sm text-ink">The text could not be loaded. Please try again later.</p>}
        {data && (
          <>
            <p className="text-xs text-archive mb-2">
              Text taken from the document. Layout such as columns and tables may not be kept.
            </p>
            {paged ? (
              pages.map((p) => (
                <PageText key={p.page ?? 'all'} page={p.page ?? null} text={p.text} />
              ))
            ) : (
              <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{pages[0]?.text}</p>
            )}
            {data.truncated && (
              <p className="text-sm text-ink mt-3">The text is too long to show in full here.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PageText({ page, text }: { page: number | null; text: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-3 first:mt-0">
      <h4 id={headingId} className="text-sm font-medium text-ink">Page {page}</h4>
      {text ? (
        <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap mt-1">{text}</p>
      ) : (
        <p className="text-sm text-archive mt-1">No text on this page.</p>
      )}
    </section>
  );
}

function TextAlternativeLinks({ item, includeCaptionFiles }: { item: DiscoverMediaItem; includeCaptionFiles: boolean }) {
  const texts = item.text_alternatives || [];
  const captionFiles = includeCaptionFiles ? item.captions || [] : [];
  if (texts.length === 0 && captionFiles.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {texts.map((t) => (
        <li key={t.url}>
          <a href={resolvePublicApiUrl(t.url)} className={LINK_CLASS}>
            {t.label}: {item.name} (plain text{t.file_size ? `, ${formatFileSize(t.file_size)}` : ''})
          </a>
        </li>
      ))}
      {captionFiles.map((c) => (
        <li key={c.url}>
          <a href={resolvePublicApiUrl(c.url)} className={LINK_CLASS}>
            Timed text, {c.label}: {item.name} (WebVTT)
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Download links the file's public download level allows; nothing when none. */
export function MediaDownloads({ item, className = 'mt-3' }: { item: DiscoverMediaItem; className?: string }) {
  const downloads = item.downloads || [];
  if (downloads.length === 0) return null;
  const name = item.name || item.alt_text || 'this file';
  return (
    <ul aria-label={`Downloads for ${name}`} className={`${className} space-y-1 text-sm`}>
      {downloads.map((d) => {
        const facts = [
          d.format,
          d.width && d.height ? `${d.width} by ${d.height} pixels` : null,
          d.file_size ? formatFileSize(d.file_size) : null,
        ].filter(Boolean);
        return (
          <li key={d.variant}>
            <a href={resolvePublicApiUrl(d.url)} className={`inline-flex items-center gap-1.5 ${LINK_CLASS}`}>
              <Download size={16} aria-hidden="true" />
              Download {d.variant === 'original' ? 'original file' : 'access copy'}: {name}
              {facts.length > 0 ? ` (${facts.join(', ')})` : ''}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function MediaFacts({ item }: { item: DiscoverMediaItem }) {
  const duration = formatDuration(item.duration_seconds);
  const facts = [
    duration ? `Duration ${duration}` : null,
    item.page_count ? `${item.page_count} page${item.page_count === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  if (facts.length === 0 && !item.description && !item.credit) return null;
  return (
    <>
      {item.description && <p className="text-sm text-ink mt-1">{item.description}</p>}
      {facts.length > 0 && <p className="text-xs text-archive mt-1">{facts.join(' · ')}</p>}
      {item.credit && <p className="text-xs text-archive mt-1">Credit: {item.credit}</p>}
    </>
  );
}

/** Shown in place of a player or link when nothing may be served yet. */
function NotYetAvailable({ item }: { item: DiscoverMediaItem }) {
  const kind = item.media_type === 'audio' ? 'recording' : item.media_type === 'video' ? 'video' : 'document';
  const hasText = !!(item.transcript || item.text_url || (item.text_alternatives || []).length > 0);
  if (item.playback_status === 'text_only') {
    return <p className="mt-3 text-sm text-ink">This document is available on this page as text.</p>;
  }
  const preparing = item.playback_status === 'preparing';
  const what = item.media_type === 'document' ? 'A viewable copy' : 'A playable copy';
  return (
    <p role="status" className="mt-3 p-3 text-sm text-ink bg-stone/20 rounded border border-lichen">
      {preparing
        ? `${what} of this ${kind} is being prepared. Please check back later.`
        : `This ${kind} cannot be ${item.media_type === 'document' ? 'opened' : 'played'} online yet.`}
      {hasText && (item.media_type === 'document' ? ' Its text is below.' : ' Its text version is below.')}
    </p>
  );
}

function DocumentLink({ item, name }: { item: DiscoverMediaItem; name: string }) {
  if (!item.url) return null;
  if (item.playback_source === 'access_copy') {
    const facts = ['PDF', item.page_count ? `${item.page_count} page${item.page_count === 1 ? '' : 's'}` : null, 'no text layer']
      .filter(Boolean)
      .join(', ');
    return (
      <p className="mt-3 text-sm">
        <a href={item.url} className={`inline-flex items-center gap-1.5 ${LINK_CLASS}`}>
          <FileText size={16} aria-hidden="true" />
          Open page images of {name} ({facts})
        </a>
      </p>
    );
  }
  return (
    <p className="mt-3 text-sm">
      <a href={item.url} className={`inline-flex items-center gap-1.5 ${LINK_CLASS}`}>
        <FileText size={16} aria-hidden="true" />
        Open {name} ({[documentTypeLabel(item.mime_type), item.file_size ? formatFileSize(item.file_size) : null]
          .filter(Boolean)
          .join(', ')})
      </a>
    </p>
  );
}

function PublicMediaEntry({ item }: { item: DiscoverMediaItem }) {
  const headingId = useId();
  const name = item.name || 'Untitled file';
  const captions = item.captions || [];
  const playable = !!item.url;

  return (
    <li className="py-5 border-b border-lichen last:border-b-0">
      <article aria-labelledby={headingId}>
        <h3 id={headingId} className="text-base font-medium text-ink">
          {name}
          <span className="sr-only">
            {item.media_type === 'audio' ? ', audio' : item.media_type === 'video' ? ', video' : ', document'}
          </span>
        </h3>
        <MediaFacts item={item} />

        {!playable && <NotYetAvailable item={item} />}

        {item.media_type === 'audio' && item.url && (
          // Audio-only content is made accessible by its transcript (WCAG
          // 1.2.1); browsers do not render <track> on <audio>.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio
            controls
            preload="metadata"
            src={item.url}
            aria-labelledby={headingId}
            className="mt-3 w-full max-w-xl"
          >
            <a href={item.url} className={LINK_CLASS}>Listen to {name}</a>
          </audio>
        )}

        {item.media_type === 'video' && item.url && (
          // Caption <track>s are rendered from item.captions below; the rule
          // cannot see a mapped child. A missing-captions notice follows.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            controls
            preload="metadata"
            playsInline
            src={item.url}
            poster={item.poster_url || undefined}
            aria-labelledby={headingId}
            className="mt-3 w-full max-w-3xl rounded bg-ink"
          >
            {captions.map((c) => (
              <track
                key={c.url}
                kind="captions"
                src={resolvePublicApiUrl(c.url)}
                srcLang={c.srclang}
                label={c.label}
                default={!!c.default}
              />
            ))}
            <a href={item.url} className={LINK_CLASS}>Watch {name}</a>
          </video>
        )}

        {item.media_type === 'video' && playable && captions.length === 0 && (
          <p className="text-xs text-archive mt-2">No captions are available for this video yet.</p>
        )}

        {item.media_type === 'document' && (
          <>
            {/* The text first: a page-image copy has no text layer. */}
            <DocumentTextView item={item} />
            <DocumentLink item={item} name={name} />
          </>
        )}

        <MediaDownloads item={item} />
        <TranscriptDisclosure item={item} />
        {/* Audio players never render captions, and with no player at all a
            video's captions can only be offered as files. */}
        <TextAlternativeLinks
          item={item}
          includeCaptionFiles={(item.media_type === 'audio' && !item.transcript) || (item.media_type === 'video' && !playable)}
        />
      </article>
    </li>
  );
}

export function PublicMediaList({ items }: { items: DiscoverMediaItem[] }) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2 id={headingId} className="text-xs font-medium text-archive uppercase tracking-wide mb-1">
        Audio, video and documents
      </h2>
      <ul>
        {items.map((item) => (
          <PublicMediaEntry key={item.media_id} item={item} />
        ))}
      </ul>
    </section>
  );
}
