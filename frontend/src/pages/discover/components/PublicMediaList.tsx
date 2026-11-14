import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { DiscoverMediaItem } from '../../../types/discover';
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
 */

const LINK_CLASS =
  'text-bark hover:text-copper-dark underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

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
        className="inline-flex items-center gap-1 min-h-[44px] px-2 -mx-2 text-sm font-medium text-bark hover:text-copper-dark rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
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

function PublicMediaEntry({ item }: { item: DiscoverMediaItem }) {
  const headingId = useId();
  const name = item.name || 'Untitled file';
  const captions = item.captions || [];

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

        {item.media_type === 'audio' && (
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

        {item.media_type === 'video' && (
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

        {item.media_type === 'video' && captions.length === 0 && (
          <p className="text-xs text-archive mt-2">No captions are available for this video yet.</p>
        )}

        {item.media_type === 'document' && (
          <p className="mt-3 text-sm">
            <a href={item.url} className={`inline-flex items-center gap-1.5 ${LINK_CLASS}`}>
              <FileText size={16} aria-hidden="true" />
              Open {name} ({[documentTypeLabel(item.mime_type), item.file_size ? formatFileSize(item.file_size) : null]
                .filter(Boolean)
                .join(', ')})
            </a>
          </p>
        )}

        <TranscriptDisclosure item={item} />
        {/* Audio players never render captions, so offer the timed text as a file. */}
        <TextAlternativeLinks item={item} includeCaptionFiles={item.media_type === 'audio' && !item.transcript} />
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
