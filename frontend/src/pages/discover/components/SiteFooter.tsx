import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DiscoverCollectionInfo, FooterColumn } from '../../../types/discover';
import { getPublicMenu } from '../../../lib/api/content';
import type { PublicMenuItem } from '../../../types/content';
import { resolveUrl } from './NavMenuItem';

interface SiteFooterProps {
  info: DiscoverCollectionInfo | undefined;
  orgSlug: string;
}

// SVG social icons
function InstagramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
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

function YouTubeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function LinkedInIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function BlueskyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.627 3.584 3.493 6.173 3.168-.39.055-1.633.3-2.478 1.125-2.114 2.06.71 4.083 1.532 4.545 2.77 1.558 5.16.442 6.15-1.122.142-.224.27-.464.384-.718l.062-.142.062.142c.115.254.242.494.384.718.99 1.564 3.38 2.68 6.15 1.122.822-.462 3.645-2.485 1.532-4.545-.846-.825-2.088-1.07-2.478-1.125 2.59.325 5.388-.541 6.173-3.168C24.415 9.418 24.793 4.458 24.793 3.768c0-.689-.139-1.861-.902-2.203-.66-.299-1.664-.621-4.3 1.24C16.84 4.748 13.88 8.686 12.793 10.8z" />
    </svg>
  );
}

function TikTokIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

function SpotifyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function SoundCloudIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.255-2.154c-.009-.057-.049-.1-.099-.1zm-.899.828c-.06 0-.091.037-.104.094L0 14.479l.172 1.282c.013.06.045.094.104.094.057 0 .09-.035.104-.094l.198-1.282-.198-1.332c-.014-.057-.047-.094-.104-.094zm1.79-1.065c-.067 0-.12.058-.12.127l-.214 2.364.214 2.279c0 .07.053.127.12.127.065 0 .12-.057.12-.127l.237-2.279-.237-2.364c0-.07-.055-.127-.12-.127zm.899-.184c-.078 0-.138.063-.138.14l-.192 2.548.192 2.345c0 .078.06.14.138.14.076 0 .138-.062.138-.14l.218-2.345-.218-2.548c0-.077-.062-.14-.138-.14zm.897-.121c-.09 0-.158.068-.158.153l-.174 2.669.174 2.385c0 .085.068.153.158.153.088 0 .158-.068.158-.153l.194-2.385-.194-2.669c0-.085-.07-.153-.158-.153zm.901-.091c-.1 0-.18.082-.18.173l-.152 2.76.152 2.404c0 .091.08.173.18.173.098 0 .18-.082.18-.173l.172-2.404-.172-2.76c0-.091-.082-.173-.18-.173zm.899-.069c-.11 0-.2.09-.2.192l-.131 2.83.131 2.416c0 .1.09.192.2.192.108 0 .2-.092.2-.192l.148-2.416-.148-2.83c0-.102-.092-.192-.2-.192zm.9 0c-.12 0-.22.1-.22.212l-.112 2.83.112 2.398c0 .114.1.214.22.214.118 0 .22-.1.22-.214l.128-2.398-.128-2.83c0-.112-.102-.212-.22-.212zm.91-.055c-.13 0-.24.108-.24.228l-.1 2.885.1 2.385c0 .122.11.228.24.228.128 0 .238-.106.238-.228l.113-2.385-.113-2.885c0-.12-.11-.228-.238-.228zm1.377-1.4c-.048 0-.095.008-.14.023-.14 0-.26.12-.26.244l-.09 4.285.09 2.346c0 .13.12.243.26.243.14 0 .26-.114.26-.243l.1-2.346-.1-4.285c0-.128-.12-.244-.26-.244-.02 0-.04-.013-.06-.023zm.957-.105c-.153 0-.28.127-.28.275l-.07 4.39.07 2.312c0 .147.127.275.28.275.15 0 .28-.128.28-.275l.08-2.312-.08-4.39c0-.148-.13-.275-.28-.275zm.901 0c-.165 0-.3.135-.3.293l-.05 4.39.05 2.29c0 .158.135.293.3.293.163 0 .3-.135.3-.293l.06-2.29-.06-4.39c0-.158-.137-.293-.3-.293zm5.863 1.25c-.411 0-.808.06-1.182.172-.244-2.697-2.535-4.812-5.354-4.812-.652 0-1.285.12-1.864.332-.216.08-.273.16-.273.317v9.383c0 .163.131.3.295.31h8.378C22.305 19.222 24 17.527 24 15.4c0-2.128-1.695-3.85-3.8-3.85z" />
    </svg>
  );
}

const SOCIAL_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  instagram: InstagramIcon,
  x: XIcon,
  twitter: XIcon,
  facebook: FacebookIcon,
  youtube: YouTubeIcon,
  linkedin: LinkedInIcon,
  bluesky: BlueskyIcon,
  tiktok: TikTokIcon,
  spotify: SpotifyIcon,
  soundcloud: SoundCloudIcon,
};

function FooterColumnRenderer({ column, orgSlug: _orgSlug }: { column: FooterColumn; orgSlug: string }) {
  if (column.type === 'links') {
    const links = column.content as Array<{ label: string; url: string }>;
    return (
      <div>
        <h3 className="text-sm font-medium text-parchment mb-3">{column.heading}</h3>
        <ul className="space-y-2">
          {links?.map((link, i) => {
            const external = link.url.startsWith('http://') || link.url.startsWith('https://');
            return (
              <li key={i}>
                {external ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-parchment/60 hover:text-parchment transition-colors"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    to={link.url}
                    className="text-sm text-parchment/60 hover:text-parchment transition-colors"
                  >
                    {link.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (column.type === 'hours') {
    const hours = column.content as Record<string, { open: string; close: string }>;
    const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    return (
      <div>
        <h3 className="text-sm font-medium text-parchment mb-3">{column.heading}</h3>
        <dl className="space-y-1">
          {dayOrder.map((day) => {
            const h = hours?.[day];
            if (!h) return null;
            return (
              <div key={day} className="flex justify-between text-sm text-parchment/60">
                <dt className="capitalize">{day.slice(0, 3)}</dt>
                <dd>{h.open === 'closed' ? 'Closed' : `${h.open} - ${h.close}`}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    );
  }

  // type === 'text'
  const text = column.content as string;
  return (
    <div>
      <h3 className="text-sm font-medium text-parchment mb-3">{column.heading}</h3>
      <p className="text-sm text-parchment/60 leading-relaxed whitespace-pre-line">{text}</p>
    </div>
  );
}

function FooterMenuLinks({ items, orgSlug }: { items: PublicMenuItem[]; orgSlug: string }) {
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map((item, i) => {
        const url = resolveUrl(item, orgSlug);
        const external = url.startsWith('http://') || url.startsWith('https://');
        return external ? (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-parchment/60 hover:text-parchment transition-colors"
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={i}
            to={url}
            className="text-sm text-parchment/60 hover:text-parchment transition-colors"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteFooter({ info, orgSlug }: SiteFooterProps) {
  // Fetch footer menu
  const { data: footerMenuData } = useQuery({
    queryKey: ['public-menu', orgSlug, 'footer'],
    queryFn: () => getPublicMenu(orgSlug, 'footer'),
    enabled: !!orgSlug,
  });

  const footerMenuItems = footerMenuData?.data?.items ?? [];
  const hasFooterMenu = footerMenuItems.length > 0;
  const hasFooterColumns = info?.footer_columns && info.footer_columns.length > 0;
  const hasFooterContent = info?.footer_text || (info?.social_links && info.social_links.length > 0) || hasFooterMenu || hasFooterColumns;

  if (!hasFooterContent) {
    return (
      <footer className="bg-forest border-t border-parchment/10">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center">
          <p className="text-xs text-parchment/60">
            Powered by{' '}
            <Link to="/" className="text-parchment/70 hover:text-parchment transition-colors">
              Madrona
            </Link>
          </p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-forest border-t border-parchment/10">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Rich footer columns (Phase 2B) */}
        {hasFooterColumns && (
          <div className={`grid gap-8 mb-8 ${
            info!.footer_columns!.length === 1 ? 'grid-cols-1' :
            info!.footer_columns!.length === 2 ? 'grid-cols-1 sm:grid-cols-2' :
            info!.footer_columns!.length === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' :
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
          }`}>
            {info!.footer_columns!.map((column, i) => (
              <FooterColumnRenderer key={i} column={column} orgSlug={orgSlug} />
            ))}
          </div>
        )}

        {/* Footer menu links */}
        {hasFooterMenu && (
          <div className="mb-6">
            <FooterMenuLinks items={footerMenuItems} orgSlug={orgSlug} />
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Footer text */}
          {info?.footer_text && (
            <p className="text-sm text-parchment/60 text-center sm:text-left">
              {info.footer_text}
            </p>
          )}

          {/* Social links */}
          {info?.social_links && info.social_links.length > 0 && (
            <div className="flex items-center gap-3">
              {info.social_links.map((link, i) => {
                const Icon = SOCIAL_ICONS[link.platform];
                return (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-parchment/50 hover:text-parchment transition-colors"
                    aria-label={link.platform}
                  >
                    {Icon ? <Icon size={18} /> : <span className="text-xs">{link.platform}</span>}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Land acknowledgment (Phase 2B) */}
        {info?.land_acknowledgment && (
          <div className="mt-6 pt-4 border-t border-parchment/10">
            <p className="text-xs text-parchment/40 leading-relaxed italic">
              {info.land_acknowledgment}
            </p>
          </div>
        )}

        {/* Madrona credit */}
        <div className="mt-4 pt-4 border-t border-parchment/10 text-center">
          <p className="text-xs text-parchment/60">
            Powered by{' '}
            <Link to="/" className="text-parchment/70 hover:text-parchment transition-colors">
              Madrona
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
