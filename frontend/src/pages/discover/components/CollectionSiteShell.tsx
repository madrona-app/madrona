import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { Menu, Search } from 'lucide-react';
import type { DiscoverCollectionInfo } from '../../../types/discover';
import { getPublicMenu } from '../../../lib/api/content';
import { NavMenuItem } from './NavMenuItem';
import { MobileMenu } from './MobileMenu';
import { SiteFooter } from './SiteFooter';
import { VisitorChatWidget } from './VisitorChatWidget';

interface CollectionSiteShellProps {
  info: DiscoverCollectionInfo | undefined;
  orgSlug: string;
  children: React.ReactNode;
  contextEntityType?: string;
  contextEntityId?: string;
}

export function CollectionSiteShell({ info, orgSlug, children, contextEntityType, contextEntityId }: CollectionSiteShellProps) {
  const primaryColor = info?.primary_color || 'rgb(var(--color-forest))';
  const accentColor = info?.accent_color || 'rgb(var(--color-copper))';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Phase 2A: Extended theming CSS vars
  const secondaryColor = info?.secondary_color;
  const bgColor = info?.background_color;
  const textColor = info?.text_color;
  const headingFont = info?.heading_font_family;
  const bodyFont = info?.body_font_family;

  // Phase 8: Google Fonts loading
  const googleFonts = info?.google_fonts;
  const googleFontsUrl = googleFonts && googleFonts.length > 0
    ? `https://fonts.googleapis.com/css2?${googleFonts.map(f => `family=${encodeURIComponent(f)}:wght@400;500;600;700`).join('&')}&display=swap`
    : null;

  // Phase 8: Analytics injection (with deduplication guards)
  //
  // Two of these IDs end up inside the body of an inline <script>, so they are
  // a script-injection sink. The API validates them on write, but rows stored
  // before that check existed are still in the database — a value that came
  // from the server is not a value we can trust. Anything that is not the
  // shape the provider issues is dropped here rather than injected.
  const analytics = info?.analytics_config;
  useEffect(() => {
    if (!analytics) return;
    const GA_ID = /^(?:G|UA|AW|DC)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/;
    const GTM_ID = /^GTM-[A-Za-z0-9]+$/;
    const HOSTNAME =
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
    const ok = (value: string | undefined, pattern: RegExp): string | null =>
      typeof value === 'string' && pattern.test(value) ? value : null;

    // Google Analytics — guard via data attribute
    const gaId = ok(analytics.ga_id, GA_ID);
    if (gaId && !document.querySelector(`script[data-madrona-ga="${gaId}"]`)) {
      const script = document.createElement('script');
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
      script.async = true;
      script.dataset.madronaGa = gaId;
      document.head.appendChild(script);
      const inline = document.createElement('script');
      // JSON.stringify, not bare interpolation: the regex already excludes
      // quotes, and this makes the escaping local to the line rather than a
      // property of a check somewhere above.
      inline.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(gaId)});`;
      inline.dataset.madronaGaInline = gaId;
      document.head.appendChild(inline);
    }
    // Google Tag Manager
    const gtmId = ok(analytics.gtm_id, GTM_ID);
    if (gtmId && !document.querySelector(`script[data-madrona-gtm="${gtmId}"]`)) {
      const script = document.createElement('script');
      script.textContent = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(i)+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(gtmId)});`;
      script.dataset.madronaGtm = gtmId;
      document.head.appendChild(script);
    }
    // Plausible — the domain only ever reaches a data attribute, but an
    // invalid one would silently mis-attribute traffic, so it is checked too.
    const plausibleDomain = ok(analytics.plausible_domain, HOSTNAME);
    if (
      plausibleDomain &&
      !document.querySelector(`script[data-madrona-plausible="${plausibleDomain}"]`)
    ) {
      const script = document.createElement('script');
      script.defer = true;
      script.dataset.domain = plausibleDomain;
      script.dataset.madronaPlausible = plausibleDomain;
      script.src = 'https://plausible.io/js/script.js';
      document.head.appendChild(script);
    }
  }, [analytics]);

  // Fetch content menus (may not exist for Discover-only orgs)
  const { data: headerMenuData } = useQuery({
    queryKey: ['public-menu', orgSlug, 'header'],
    queryFn: () => getPublicMenu(orgSlug, 'header'),
    enabled: !!orgSlug,
  });

  const headerMenuItems = headerMenuData?.data?.items ?? [];
  const hasContentMenu = headerMenuItems.length > 0;

  // Phase 7: External integration CTAs
  const integrations = info?.external_integrations;

  // Phase 2A: Button & header style
  const buttonStyle = info?.button_style ?? 'rounded';
  const headerStyle = info?.header_style ?? 'solid';
  const btnRadius =
    buttonStyle === 'pill' ? 'rounded-full' :
    buttonStyle === 'square' ? 'rounded-none' :
    'rounded';
  const headerBg =
    headerStyle === 'transparent' ? 'bg-forest/80 backdrop-blur-sm' :
    headerStyle === 'gradient' ? 'bg-gradient-to-r from-forest to-forest/80' :
    'bg-forest';

  return (
    <div
      className="h-full flex flex-col"
      style={{
        '--c-primary': primaryColor,
        '--c-accent': accentColor,
        ...(secondaryColor ? { '--c-secondary': secondaryColor } : {}),
        ...(bgColor ? { '--c-bg': bgColor } : {}),
        ...(textColor ? { '--c-text': textColor } : {}),
        ...(headingFont ? { '--c-heading-font': headingFont } : {}),
        ...(bodyFont ? { '--c-body-font': bodyFont } : {}),
      } as React.CSSProperties}
    >
      {/* Google Fonts & custom CSS */}
      <Helmet>
        {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
        {info?.custom_css && <style>{info.custom_css}</style>}
      </Helmet>

      {/* Site header */}
      <header className={`sticky top-0 z-30 ${headerBg}`}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Mobile hamburger button */}
            <button
              className="md:hidden p-1.5 text-parchment/60 hover:text-parchment transition-colors"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>

            <Link to={`/c/${orgSlug}`} className="flex items-center gap-3">
              {info?.header_logo_url ? (
                <img
                  src={info.header_logo_url}
                  alt={info.organization_name}
                  className="h-8 w-auto object-contain"
                />
              ) : (
                <span className="text-sm font-medium text-parchment tracking-wide">
                  {info?.organization_name || 'Collection'}
                </span>
              )}
            </Link>

            {/* Nav links — prefer content menu, fall back to nav_items */}
            {hasContentMenu ? (
              <nav className="hidden md:flex items-center gap-4 ml-4">
                {headerMenuItems.map((item, i) => (
                  <NavMenuItem key={i} item={item} orgSlug={orgSlug} />
                ))}
              </nav>
            ) : info?.nav_items && info.nav_items.length > 0 ? (
              <nav className="hidden md:flex items-center gap-4 ml-4">
                {info.nav_items.map((item, i) => (
                  <a
                    key={i}
                    href={item.url}
                    className="text-sm text-parchment/70 hover:text-parchment transition-colors"
                    target={item.url.startsWith('http') ? '_blank' : undefined}
                    rel={item.url.startsWith('http') ? 'noopener noreferrer' : undefined}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {/* Phase 7: External integration CTA buttons */}
            {integrations?.membership?.url && (
              <a
                href={integrations.membership.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`hidden sm:inline-flex items-center px-3 py-1.5 text-xs font-medium text-parchment bg-parchment/10 hover:bg-parchment/20 ${btnRadius} transition-colors`}
              >
                {integrations.membership.button_text || 'Join'}
              </a>
            )}
            {integrations?.donate?.url && (
              <a
                href={integrations.donate.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`hidden sm:inline-flex items-center px-3 py-1.5 text-xs font-medium text-parchment bg-parchment/10 hover:bg-parchment/20 ${btnRadius} transition-colors`}
              >
                {integrations.donate.button_text || 'Donate'}
              </a>
            )}
            {integrations?.shop?.url && (
              <a
                href={integrations.shop.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`hidden lg:inline-flex items-center px-3 py-1.5 text-xs font-medium text-parchment bg-parchment/10 hover:bg-parchment/20 ${btnRadius} transition-colors`}
              >
                {integrations.shop.button_text || 'Shop'}
              </a>
            )}
            {info?.header_logo_url && (
              <span className="text-sm text-parchment/50 hidden sm:inline">
                {info.organization_name}
              </span>
            )}
            <Link
              to={`/c/${orgSlug}`}
              className="p-1.5 text-parchment/60 hover:text-parchment transition-colors"
              aria-label="Search the collection"
            >
              <Search size={18} />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        items={headerMenuItems}
        orgSlug={orgSlug}
      />

      {/* Page content */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: bgColor || undefined }}>
        {children}
      </div>

      {/* Site footer */}
      <SiteFooter info={info} orgSlug={orgSlug} />

      {/* Visitor gallery guide chat — requires the per-org widget gate, not
          just Guide ownership (widget is off by default until enabled) */}
      {info?.widget_enabled && (
        <VisitorChatWidget
          orgSlug={orgSlug}
          contextEntityType={contextEntityType}
          contextEntityId={contextEntityId}
          welcomeMessage={info.widget_welcome_message ?? undefined}
        />
      )}
    </div>
  );
}
