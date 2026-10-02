/**
 * ContentSiteSettingsPage — Full CMS site settings.
 *
 * Sections:
 * 1. Public Site URL
 * 2. Branding (colors, logo, font from DiscoverConfig)
 * 3. Extended Theming (Phase 2A)
 * 4. Header Navigation (MenuBuilder)
 * 5. Footer (footer text, social links, MenuBuilder)
 * 6. Rich Footer (Phase 2B)
 * 7. External Integrations (Phase 7)
 * 8. Analytics (Phase 8)
 */

import { useState, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  ExternalLink,
  Globe,
  Loader2,
  Save,
  Palette,
  Navigation,
  LayoutGrid,
  Home,
  Paintbrush,
  Columns3,
  Link2,
  BarChart3,
  Plus,
  Trash2,
  ImageIcon,
  X,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { getDiscoverConfig, updateDiscoverConfig } from '../../lib/api/discover';
import { listPages, listRedirects, createRedirect, updateRedirect, deleteRedirect } from '../../lib/api/content';
import type { Redirect } from '../../lib/api/content';
import { useAuth } from '../../hooks/useAuth';
import { MenuBuilder } from './components/MenuBuilder';
import { MediaPickerModal } from '../../components/content/MediaPickerModal';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// =============================================================================
// Types for footer columns and integrations
// =============================================================================

interface FooterColumn {
  heading: string;
  type: 'links' | 'text' | 'hours';
  content: string;
}

interface IntegrationsState {
  ticketing: { base_url: string; button_text: string };
  membership: { url: string; button_text: string };
  shop: { url: string; button_text: string };
  donate: { url: string; button_text: string };
}

interface AnalyticsConfig {
  ga_id: string;
  gtm_id: string;
  plausible_domain: string;
}

interface CdnConfig {
  provider: 'cloudflare' | 'cloudfront' | '';
  zone_id: string;
  api_token: string;
  distribution_id: string;
}

// =============================================================================
// Social platform options
// =============================================================================

const SOCIAL_PLATFORMS = [
  'instagram',
  'x',
  'facebook',
  'youtube',
  'linkedin',
] as const;

const BUTTON_STYLE_OPTIONS = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'square', label: 'Square' },
  { value: 'pill', label: 'Pill' },
] as const;

const HEADER_STYLE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'transparent', label: 'Transparent' },
  { value: 'gradient', label: 'Gradient' },
] as const;

type ButtonStyle = (typeof BUTTON_STYLE_OPTIONS)[number]['value'];
type HeaderStyle = (typeof HEADER_STYLE_OPTIONS)[number]['value'];

function toButtonStyle(value: string): ButtonStyle | undefined {
  return BUTTON_STYLE_OPTIONS.find((o) => o.value === value)?.value;
}

function toHeaderStyle(value: string): HeaderStyle | undefined {
  return HEADER_STYLE_OPTIONS.find((o) => o.value === value)?.value;
}

const FOOTER_COLUMN_TYPES = [
  { value: 'links', label: 'Links' },
  { value: 'text', label: 'Text' },
  { value: 'hours', label: 'Hours' },
] as const;

const DEFAULT_INTEGRATIONS: IntegrationsState = {
  ticketing: { base_url: '', button_text: '' },
  membership: { url: '', button_text: '' },
  shop: { url: '', button_text: '' },
  donate: { url: '', button_text: '' },
};

const DEFAULT_ANALYTICS: AnalyticsConfig = {
  ga_id: '',
  gtm_id: '',
  plausible_domain: '',
};

const DEFAULT_CDN: CdnConfig = {
  provider: '',
  zone_id: '',
  api_token: '',
  distribution_id: '',
};

// =============================================================================
// RedirectManager (inline sub-component)
// =============================================================================

function RedirectManager({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newType, setNewType] = useState(301);

  const { data: redirectsData, isLoading } = useQuery({
    queryKey: ['redirects', orgId],
    queryFn: () => listRedirects(orgId, { limit: 200 }),
    enabled: !!orgId,
  });

  const redirects = redirectsData?.items ?? [];

  const createMut = useMutation({
    mutationFn: () =>
      createRedirect(orgId, {
        source_path: newSource,
        target_path: newTarget,
        redirect_type: newType,
      }),
    onSuccess: () => {
      setNewSource('');
      setNewTarget('');
      setNewType(301);
      queryClient.invalidateQueries({ queryKey: ['redirects', orgId] });
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({
      redirectId,
      isActive,
    }: {
      redirectId: string;
      isActive: boolean;
    }) => updateRedirect(orgId, redirectId, { is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['redirects', orgId] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (redirectId: string) => deleteRedirect(orgId, redirectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['redirects', orgId] });
    },
  });

  return (
    <div>
      {/* Add redirect form */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          placeholder="/pages/old-slug"
          className="flex-1 border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
        />
        <input
          type="text"
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          placeholder="/pages/new-slug"
          className="flex-1 border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
        />
        <select
          value={newType}
          onChange={(e) => setNewType(Number(e.target.value))}
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <option value={301}>301 (Permanent)</option>
          <option value={302}>302 (Temporary)</option>
        </select>
        <button
          onClick={() => createMut.mutate()}
          disabled={
            !newSource.trim() || !newTarget.trim() || createMut.isPending
          }
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {createMut.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Add
        </button>
      </div>

      {/* Redirects list */}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <MadronaLoader variant="dots" />
        </div>
      ) : redirects.length === 0 ? (
        <p className="text-sm text-archive py-4 text-center">
          No redirects configured. Redirects are automatically created when you
          change a page slug.
        </p>
      ) : (
        <div className="border border-lichen rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone/30">
                <th className="text-left px-3 py-2 text-xs font-medium text-archive uppercase tracking-wide">
                  Source
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-archive uppercase tracking-wide">
                  Target
                </th>
                <th className="text-center px-3 py-2 text-xs font-medium text-archive uppercase tracking-wide">
                  Type
                </th>
                <th className="text-center px-3 py-2 text-xs font-medium text-archive uppercase tracking-wide">
                  Active
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {redirects.map((r: Redirect) => (
                <tr key={r.redirect_id} className="hover:bg-stone">
                  <td className="px-3 py-2 font-mono text-xs text-ink truncate max-w-[200px]">
                    {r.source_path}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink truncate max-w-[200px]">
                    {r.target_path}
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-archive">
                    {r.redirect_type}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() =>
                        toggleMut.mutate({
                          redirectId: r.redirect_id,
                          isActive: !r.is_active,
                        })
                      }
                      className={`text-xs px-2 py-0.5 rounded ${
                        r.is_active
                          ? 'bg-semantic-success/10 text-semantic-success'
                          : 'bg-stone text-archive'
                      }`}
                    >
                      {r.is_active ? 'Yes' : 'No'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteMut.mutate(r.redirect_id)}
                      className="p-1 text-archive hover:text-semantic-error transition-colors"
                      title="Delete redirect"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function ContentSiteSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { applications, memberships } = useAuth();
  const queryClient = useQueryClient();

  // Get org info from auth memberships (already loaded via /me endpoint)
  const activeOrg = memberships.find((m) => m.organization_id === orgId);
  const orgSlug = activeOrg?.slug ?? '';
  const orgName = activeOrg?.name ?? '';
  const publicUrl = orgSlug ? `/c/${orgSlug}` : null;

  // Check if the org has the Discover product enabled
  const hasDiscover = applications?.some(
    (app) => app.key === 'discover' && app.enabled,
  );

  // Fetch DiscoverConfig for branding + footer
  const { data: discoverConfig, isLoading: isLoadingConfig } = useQuery({
    queryKey: ['discover-config', orgId],
    queryFn: () => getDiscoverConfig(orgId!),
    enabled: !!orgId,
  });

  // Fetch published pages for homepage selector
  const { data: pagesData } = useQuery({
    queryKey: ['content-pages-for-homepage', orgId],
    queryFn: () => listPages(orgId!, { page_type: 'page', status: 'published', limit: 100 }),
    enabled: !!orgId,
  });
  const publishedPages = pagesData?.items ?? [];

  // Branding form state
  const [primaryColor, setPrimaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [fontFamily, setFontFamily] = useState('');
  const [footerText, setFooterText] = useState('');
  const [socialLinks, setSocialLinks] = useState<Array<{ platform: string; url: string }>>([]);
  const [homepagePageId, setHomepagePageId] = useState('');
  const [brandingDirty, setBrandingDirty] = useState(false);
  const [footerDirty, setFooterDirty] = useState(false);
  const [homepageDirty, setHomepageDirty] = useState(false);
  const [brandingSuccess, setBrandingSuccess] = useState('');
  const [footerSuccess, setFooterSuccess] = useState('');
  const [homepageSuccess, setHomepageSuccess] = useState('');

  // Custom 404 Page
  const [custom404PageId, setCustom404PageId] = useState('');
  const [custom404Dirty, setCustom404Dirty] = useState(false);
  const [custom404Success, setCustom404Success] = useState('');

  // Phase 2A: Extended Theming
  const [secondaryColor, setSecondaryColor] = useState('');
  const [backgroundColor, setBackgroundColor] = useState('');
  const [textColor, setTextColor] = useState('');
  const [headingFontFamily, setHeadingFontFamily] = useState('');
  const [bodyFontFamily, setBodyFontFamily] = useState('');
  const [buttonStyle, setButtonStyle] = useState('rounded');
  const [headerStyle, setHeaderStyle] = useState('solid');
  const [googleFonts, setGoogleFonts] = useState('');
  const [customCss, setCustomCss] = useState('');
  const [themingDirty, setThemingDirty] = useState(false);
  const [themingSuccess, setThemingSuccess] = useState('');

  // Phase 2B: Rich Footer
  const [footerColumns, setFooterColumns] = useState<FooterColumn[]>([]);
  const [landAcknowledgment, setLandAcknowledgment] = useState('');
  const [footerLogoMediaId, setFooterLogoMediaId] = useState('');
  const [showFooterLogoPicker, setShowFooterLogoPicker] = useState(false);
  const [richFooterDirty, setRichFooterDirty] = useState(false);
  const [richFooterSuccess, setRichFooterSuccess] = useState('');

  // Phase 7: External Integrations
  const [integrations, setIntegrations] = useState<IntegrationsState>(DEFAULT_INTEGRATIONS);
  const [integrationsDirty, setIntegrationsDirty] = useState(false);
  const [integrationsSuccess, setIntegrationsSuccess] = useState('');

  // Phase 8: Analytics
  const [analyticsConfig, setAnalyticsConfig] = useState<AnalyticsConfig>(DEFAULT_ANALYTICS);
  const [analyticsDirty, setAnalyticsDirty] = useState(false);
  const [analyticsSuccess, setAnalyticsSuccess] = useState('');

  // CDN
  const [cdnConfig, setCdnConfig] = useState<CdnConfig>(DEFAULT_CDN);
  const [cdnDirty, setCdnDirty] = useState(false);
  const [cdnSuccess, setCdnSuccess] = useState('');

  // Populate from config
  useEffect(() => {
    if (discoverConfig) {
      setPrimaryColor(discoverConfig.primary_color ?? '');
      setAccentColor(discoverConfig.accent_color ?? '');
      setFontFamily(discoverConfig.font_family ?? '');
      setFooterText(discoverConfig.footer_text ?? '');
      setSocialLinks(discoverConfig.social_links ?? []);
      setHomepagePageId(discoverConfig.homepage_page_id ?? '');
      setCustom404PageId(discoverConfig.custom_404_page_id ?? '');

      // Phase 2A: Extended Theming
      setSecondaryColor(discoverConfig.secondary_color ?? '');
      setBackgroundColor(discoverConfig.background_color ?? '');
      setTextColor(discoverConfig.text_color ?? '');
      setHeadingFontFamily(discoverConfig.heading_font_family ?? '');
      setBodyFontFamily(discoverConfig.body_font_family ?? '');
      setButtonStyle(discoverConfig.button_style ?? 'rounded');
      setHeaderStyle(discoverConfig.header_style ?? 'solid');
      setGoogleFonts(
        Array.isArray(discoverConfig.google_fonts)
          ? discoverConfig.google_fonts.join(', ')
          : ''
      );
      setCustomCss(discoverConfig.custom_css ?? '');

      // Phase 2B: Rich Footer
      setFooterColumns(
        (discoverConfig.footer_columns ?? []).map((col) => ({
          heading: col.heading,
          type: col.type,
          content: typeof col.content === 'string' ? col.content : ''
        }))
      );
      setLandAcknowledgment(discoverConfig.land_acknowledgment ?? '');
      setFooterLogoMediaId(discoverConfig.footer_logo_media_id ?? '');

      // Phase 7: External Integrations
      const ext = discoverConfig.external_integrations;
      setIntegrations({
        ticketing: {
          base_url: ext?.ticketing?.base_url ?? '',
          button_text: ext?.ticketing?.button_text ?? ''
        },
        membership: {
          url: ext?.membership?.url ?? '',
          button_text: ext?.membership?.button_text ?? ''
        },
        shop: {
          url: ext?.shop?.url ?? '',
          button_text: ext?.shop?.button_text ?? ''
        },
        donate: {
          url: ext?.donate?.url ?? '',
          button_text: ext?.donate?.button_text ?? ''
        }
      });

      // Phase 8: Analytics
      setAnalyticsConfig({
        ga_id: discoverConfig.analytics_config?.ga_id ?? '',
        gtm_id: discoverConfig.analytics_config?.gtm_id ?? '',
        plausible_domain: discoverConfig.analytics_config?.plausible_domain ?? '',
      });

      // CDN
      const cdn = discoverConfig.cdn_config;
      if (cdn) {
        setCdnConfig({
          provider: cdn.provider ?? '',
          zone_id: cdn.zone_id ?? '',
          api_token: cdn.api_token ?? '',
          distribution_id: cdn.distribution_id ?? '',
        });
      }
    }
  }, [discoverConfig]);

  // Branding save
  const brandingMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        primary_color: primaryColor || null,
        accent_color: accentColor || null,
        font_family: fontFamily || null,
      }),
    onSuccess: () => {
      setBrandingDirty(false);
      setBrandingSuccess('Saved');
      setTimeout(() => setBrandingSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // Footer save
  const footerMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        footer_text: footerText || null,
        social_links: socialLinks.filter((l) => l.url.trim()),
      }),
    onSuccess: () => {
      setFooterDirty(false);
      setFooterSuccess('Saved');
      setTimeout(() => setFooterSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // Homepage save
  const homepageMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        homepage_page_id: homepagePageId || null,
      }),
    onSuccess: () => {
      setHomepageDirty(false);
      setHomepageSuccess('Saved');
      setTimeout(() => setHomepageSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
      queryClient.invalidateQueries({ queryKey: ['discover-info'] });
    },
  });

  // Custom 404 save
  const custom404Mutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        custom_404_page_id: custom404PageId || null,
      }),
    onSuccess: () => {
      setCustom404Dirty(false);
      setCustom404Success('Saved');
      setTimeout(() => setCustom404Success(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // Phase 2A: Extended Theming save
  const themingMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        secondary_color: secondaryColor || null,
        background_color: backgroundColor || null,
        text_color: textColor || null,
        heading_font_family: headingFontFamily || null,
        body_font_family: bodyFontFamily || null,
        button_style: toButtonStyle(buttonStyle),
        header_style: toHeaderStyle(headerStyle),
        google_fonts: googleFonts
          ? googleFonts.split(',').map((f: string) => f.trim()).filter(Boolean)
          : null,
        custom_css: customCss || null,
      }),
    onSuccess: () => {
      setThemingDirty(false);
      setThemingSuccess('Saved');
      setTimeout(() => setThemingSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // Phase 2B: Rich Footer save
  const richFooterMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        footer_columns: footerColumns.length > 0 ? footerColumns : null,
        land_acknowledgment: landAcknowledgment || null,
        footer_logo_media_id: footerLogoMediaId || null,
      }),
    onSuccess: () => {
      setRichFooterDirty(false);
      setRichFooterSuccess('Saved');
      setTimeout(() => setRichFooterSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // Phase 7: External Integrations save
  const integrationsMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        external_integrations: {
          ticketing: integrations.ticketing.base_url || integrations.ticketing.button_text
            ? integrations.ticketing
            : undefined,
          membership: integrations.membership.url || integrations.membership.button_text
            ? integrations.membership
            : undefined,
          shop: integrations.shop.url || integrations.shop.button_text
            ? integrations.shop
            : undefined,
          donate: integrations.donate.url || integrations.donate.button_text
            ? integrations.donate
            : undefined,
        },
      }),
    onSuccess: () => {
      setIntegrationsDirty(false);
      setIntegrationsSuccess('Saved');
      setTimeout(() => setIntegrationsSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // Phase 8: Analytics save
  const analyticsMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        analytics_config: {
          ga_id: analyticsConfig.ga_id || undefined,
          gtm_id: analyticsConfig.gtm_id || undefined,
          plausible_domain: analyticsConfig.plausible_domain || undefined,
        },
      }),
    onSuccess: () => {
      setAnalyticsDirty(false);
      setAnalyticsSuccess('Saved');
      setTimeout(() => setAnalyticsSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // Social links management
  const addSocialLink = useCallback(() => {
    setSocialLinks((prev) => [...prev, { platform: 'instagram', url: '' }]);
    setFooterDirty(true);
  }, []);

  const updateSocialLink = useCallback(
    (index: number, field: 'platform' | 'url', value: string) => {
      setSocialLinks((prev) =>
        prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
      );
      setFooterDirty(true);
    },
    [],
  );

  const removeSocialLink = useCallback((index: number) => {
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
    setFooterDirty(true);
  }, []);

  // Footer column management (Phase 2B)
  const addFooterColumn = useCallback(() => {
    setFooterColumns((prev) => [...prev, { heading: '', type: 'text', content: '' }]);
    setRichFooterDirty(true);
  }, []);

  const updateFooterColumn = useCallback(
    (index: number, field: keyof FooterColumn, value: string) => {
      setFooterColumns((prev) =>
        prev.map((col, i) => (i === index ? { ...col, [field]: value } : col)),
      );
      setRichFooterDirty(true);
    },
    [],
  );

  const removeFooterColumn = useCallback((index: number) => {
    setFooterColumns((prev) => prev.filter((_, i) => i !== index));
    setRichFooterDirty(true);
  }, []);

  // Integration field updater (Phase 7)
  const updateIntegration = useCallback(
    (key: keyof IntegrationsState, field: string, value: string) => {
      setIntegrations((prev) => ({
        ...prev,
        [key]: { ...prev[key], [field]: value },
      }));
      setIntegrationsDirty(true);
    },
    [],
  );

  // Analytics field updater (Phase 8)
  const updateAnalytics = useCallback(
    (field: keyof AnalyticsConfig, value: string) => {
      setAnalyticsConfig((prev) => ({ ...prev, [field]: value }));
      setAnalyticsDirty(true);
    },
    [],
  );

  // CDN save
  const cdnMutation = useMutation({
    mutationFn: () =>
      updateDiscoverConfig(orgId!, {
        cdn_config: cdnConfig.provider
          ? {
              provider: cdnConfig.provider,
              zone_id: cdnConfig.zone_id || undefined,
              api_token: cdnConfig.api_token || undefined,
              distribution_id: cdnConfig.distribution_id || undefined,
            }
          : null,
      }),
    onSuccess: () => {
      setCdnDirty(false);
      setCdnSuccess('Saved');
      setTimeout(() => setCdnSuccess(''), 3000);
      queryClient.invalidateQueries({ queryKey: ['discover-config', orgId] });
    },
  });

  // CDN field updater
  const updateCdn = useCallback(
    (field: keyof CdnConfig, value: string) => {
      setCdnConfig((prev) => ({ ...prev, [field]: value }));
      setCdnDirty(true);
    },
    [],
  );

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-20">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-7 h-7 text-forest" />
        <h1 className="text-2xl font-semibold text-ink">Site Settings</h1>
      </div>

      <p className="text-sm text-archive mb-8">
        Manage your public site branding, navigation, and footer.
      </p>

      {/* Section 1: Public URL */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Globe size={18} className="text-bark" />
          <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Public Site URL
          </h3>
        </div>

        {publicUrl ? (
          <div className="flex items-center gap-3">
            <code className="text-sm font-mono text-bark bg-stone/30 px-3 py-1.5 rounded-lg">
              {window.location.origin}{publicUrl}
            </code>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-bark hover:text-copper-dark transition-colors"
            >
              <ExternalLink size={14} />
              Preview
            </a>
          </div>
        ) : (
          <p className="text-sm text-archive">
            Public URL will be available once the organization slug is configured.
          </p>
        )}

        {orgName && (
          <p className="text-xs text-archive mt-3">
            Organization: <span className="font-medium text-ink">{orgName}</span>
          </p>
        )}
      </div>

      {/* Section 2: Homepage */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Home size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Homepage
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {homepageSuccess && (
              <span className="text-sm text-semantic-success">{homepageSuccess}</span>
            )}
            <button
              onClick={() => homepageMutation.mutate()}
              disabled={!homepageDirty || homepageMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {homepageMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        <p className="text-sm text-archive mb-4">
          Choose what visitors see when they land on your public site. Select a
          CMS page to use as your homepage, or keep the default collection search.
        </p>

        <select
          value={homepagePageId}
          onChange={(e) => {
            setHomepagePageId(e.target.value);
            setHomepageDirty(true);
          }}
          className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <option value="">Default (Collection Search)</option>
          {publishedPages.map((p) => (
            <option key={p.page_id} value={p.page_id}>
              {p.title || p.slug}
            </option>
          ))}
        </select>

        {homepagePageId && (
          <p className="text-xs text-archive mt-2">
            Visitors to your site will see this page instead of the collection search grid.
          </p>
        )}
      </div>

      {/* Section: Custom 404 Page */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Custom 404 Page
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {custom404Success && (
              <span className="text-sm text-semantic-success">{custom404Success}</span>
            )}
            <button
              onClick={() => custom404Mutation.mutate()}
              disabled={!custom404Dirty || custom404Mutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {custom404Mutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        <p className="text-sm text-archive mb-4">
          Choose a CMS page to display when visitors reach a URL that doesn&apos;t
          exist. If none is selected, a default &quot;Page Not Found&quot; message is shown.
        </p>

        <select
          value={custom404PageId}
          onChange={(e) => {
            setCustom404PageId(e.target.value);
            setCustom404Dirty(true);
          }}
          className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <option value="">Default (built-in 404 page)</option>
          {publishedPages.map((p) => (
            <option key={p.page_id} value={p.page_id}>
              {p.title || p.slug}
            </option>
          ))}
        </select>
      </div>

      {/* Section 3: Branding */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Palette size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Branding
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {brandingSuccess && (
              <span className="text-sm text-semantic-success">{brandingSuccess}</span>
            )}
            <button
              onClick={() => brandingMutation.mutate()}
              disabled={!brandingDirty || brandingMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {brandingMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Primary Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor || 'rgb(var(--color-forest))'}
                onChange={(e) => {
                  setPrimaryColor(e.target.value);
                  setBrandingDirty(true);
                }}
                className="w-8 h-8 border border-lichen rounded cursor-pointer"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => {
                  setPrimaryColor(e.target.value);
                  setBrandingDirty(true);
                }}
                placeholder="#1F3A2E"
                className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Accent Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor || 'rgb(var(--color-copper))'}
                onChange={(e) => {
                  setAccentColor(e.target.value);
                  setBrandingDirty(true);
                }}
                className="w-8 h-8 border border-lichen rounded cursor-pointer"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => {
                  setAccentColor(e.target.value);
                  setBrandingDirty(true);
                }}
                placeholder="#B87333"
                className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-ink mb-1">
              Font Family
            </label>
            <input
              type="text"
              value={fontFamily}
              onChange={(e) => {
                setFontFamily(e.target.value);
                setBrandingDirty(true);
              }}
              placeholder="e.g. Georgia, serif"
              className="w-full border border-lichen rounded px-2 py-1.5 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        {hasDiscover && (
          <p className="text-xs text-archive mt-4">
            Logo and hero image can be configured in{' '}
            <Link
              to={`/organizations/${orgId}/collections/config/discover`}
              className="text-bark hover:text-copper-dark"
            >
              Discover Settings
            </Link>.
          </p>
        )}
      </div>

      {/* Section: Extended Theming (Phase 2A) */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Paintbrush size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Extended Theming
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {themingSuccess && (
              <span className="text-sm text-semantic-success">{themingSuccess}</span>
            )}
            <button
              onClick={() => themingMutation.mutate()}
              disabled={!themingDirty || themingMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {themingMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        <p className="text-sm text-archive mb-4">
          Fine-tune your site appearance with additional color, typography, and
          layout options.
        </p>

        {/* Colors row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Secondary Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={secondaryColor || 'rgb(var(--color-archive))'}
                onChange={(e) => {
                  setSecondaryColor(e.target.value);
                  setThemingDirty(true);
                }}
                className="w-8 h-8 border border-lichen rounded cursor-pointer"
              />
              <input
                type="text"
                value={secondaryColor}
                onChange={(e) => {
                  setSecondaryColor(e.target.value);
                  setThemingDirty(true);
                }}
                placeholder="#6B7A7E"
                className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Background Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={backgroundColor || 'rgb(var(--color-parchment))'}
                onChange={(e) => {
                  setBackgroundColor(e.target.value);
                  setThemingDirty(true);
                }}
                className="w-8 h-8 border border-lichen rounded cursor-pointer"
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={(e) => {
                  setBackgroundColor(e.target.value);
                  setThemingDirty(true);
                }}
                placeholder="#F3ECDD"
                className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Text Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={textColor || 'rgb(var(--color-ink))'}
                onChange={(e) => {
                  setTextColor(e.target.value);
                  setThemingDirty(true);
                }}
                className="w-8 h-8 border border-lichen rounded cursor-pointer"
              />
              <input
                type="text"
                value={textColor}
                onChange={(e) => {
                  setTextColor(e.target.value);
                  setThemingDirty(true);
                }}
                placeholder="#1F1E1B"
                className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
          </div>
        </div>

        {/* Typography */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Heading Font Family
            </label>
            <input
              type="text"
              value={headingFontFamily}
              onChange={(e) => {
                setHeadingFontFamily(e.target.value);
                setThemingDirty(true);
              }}
              placeholder="e.g. Playfair Display, serif"
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Body Font Family
            </label>
            <input
              type="text"
              value={bodyFontFamily}
              onChange={(e) => {
                setBodyFontFamily(e.target.value);
                setThemingDirty(true);
              }}
              placeholder="e.g. Inter, sans-serif"
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        {/* Style selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Button Style
            </label>
            <select
              value={buttonStyle}
              onChange={(e) => {
                setButtonStyle(e.target.value);
                setThemingDirty(true);
              }}
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              {BUTTON_STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Header Style
            </label>
            <select
              value={headerStyle}
              onChange={(e) => {
                setHeaderStyle(e.target.value);
                setThemingDirty(true);
              }}
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              {HEADER_STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Google Fonts */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-ink mb-1">
            Google Fonts
          </label>
          <input
            type="text"
            value={googleFonts}
            onChange={(e) => {
              setGoogleFonts(e.target.value);
              setThemingDirty(true);
            }}
            placeholder="e.g. Playfair Display, Inter, Lora"
            className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
          <p className="text-xs text-archive mt-1">
            Comma-separated list of Google Font names to load on the public site.
          </p>
        </div>

        {/* Custom CSS */}
        <div>
          <label className="block text-xs font-medium text-ink mb-1">
            Custom CSS
          </label>
          <textarea
            value={customCss}
            onChange={(e) => {
              setCustomCss(e.target.value);
              setThemingDirty(true);
            }}
            placeholder={`/* Custom styles for your public site */\n.site-header { ... }`}
            rows={8}
            className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-y"
          />
          <p className="text-xs text-archive mt-1">
            Advanced: add custom CSS rules that apply to the public-facing site.
            Use with caution.
          </p>
        </div>
      </div>

      {/* Section 3: Header Navigation */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Navigation size={18} className="text-bark" />
          <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Header Navigation
          </h3>
        </div>
        <p className="text-sm text-archive mb-4">
          Build the main navigation menu for your site header. Items can link to
          pages, external URLs, your collection browser, or blog categories. Add
          child items for dropdown menus.
        </p>
        <MenuBuilder location="header" orgSlug={orgSlug} />
      </div>

      {/* Section 4: Footer */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <LayoutGrid size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Footer
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {footerSuccess && (
              <span className="text-sm text-semantic-success">{footerSuccess}</span>
            )}
            <button
              onClick={() => footerMutation.mutate()}
              disabled={!footerDirty || footerMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {footerMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        {/* Footer text */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-ink mb-1">
            Footer Text
          </label>
          <input
            type="text"
            value={footerText}
            onChange={(e) => {
              setFooterText(e.target.value);
              setFooterDirty(true);
            }}
            placeholder="e.g. © 2026 Museum Name. All rights reserved."
            className="w-full border border-lichen rounded px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        {/* Social links */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-ink mb-2">
            Social Links
          </label>
          {socialLinks.map((link, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <select
                value={link.platform}
                onChange={(e) => updateSocialLink(i, 'platform', e.target.value)}
                className="border border-lichen rounded px-2 py-1.5 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={link.url}
                onChange={(e) => updateSocialLink(i, 'url', e.target.value)}
                placeholder="https://..."
                className="flex-1 border border-lichen rounded px-2 py-1.5 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
              <button
                onClick={() => removeSocialLink(i)}
                className="p-1.5 text-archive hover:text-semantic-error transition-colors"
              >
                &times;
              </button>
            </div>
          ))}
          <button
            onClick={addSocialLink}
            className="text-sm text-bark hover:text-copper-dark transition-colors"
          >
            + Add social link
          </button>
        </div>

        {/* Footer navigation menu */}
        <div className="border-t border-lichen pt-4">
          <h4 className="text-xs font-medium text-ink uppercase tracking-wide mb-3">
            Footer Navigation
          </h4>
          <p className="text-sm text-archive mb-4">
            Optionally add navigation links to the footer.
          </p>
          <MenuBuilder location="footer" orgSlug={orgSlug} />
        </div>
      </div>

      {/* Section: Rich Footer (Phase 2B) */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Columns3 size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Rich Footer
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {richFooterSuccess && (
              <span className="text-sm text-semantic-success">{richFooterSuccess}</span>
            )}
            <button
              onClick={() => richFooterMutation.mutate()}
              disabled={!richFooterDirty || richFooterMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {richFooterMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        <p className="text-sm text-archive mb-4">
          Configure a multi-column footer with custom content blocks, a logo,
          and a land acknowledgment statement.
        </p>

        {/* Footer Logo */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-ink mb-1">
            Footer Logo
          </label>
          {footerLogoMediaId ? (
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 border border-lichen rounded-lg overflow-hidden bg-stone/30">
                <img
                  src={`/api/media/${footerLogoMediaId}/thumbnail?size=200`}
                  alt="Footer logo"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowFooterLogoPicker(true)}
                  className="px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:border-bark/30 transition-colors"
                >
                  Change
                </button>
                <button
                  onClick={() => {
                    setFooterLogoMediaId('');
                    setRichFooterDirty(true);
                  }}
                  className="px-3 py-1.5 text-sm border border-lichen rounded-lg text-archive hover:text-semantic-error hover:border-semantic-error/30 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowFooterLogoPicker(true)}
              className="flex items-center gap-2 px-4 py-3 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
            >
              <ImageIcon size={16} />
              Choose footer logo from media library
            </button>
          )}
        </div>

        {/* Footer Columns */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-ink mb-2">
            Footer Columns
          </label>
          <p className="text-xs text-archive mb-3">
            Add columns to your footer. Each column can contain links, text
            content, or opening hours.
          </p>

          <div className="space-y-4">
            {footerColumns.map((col, i) => (
              <div
                key={i}
                className="border border-lichen rounded-lg p-4 bg-stone/20"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-archive uppercase tracking-wide">
                    Column {i + 1}
                  </span>
                  <button
                    onClick={() => removeFooterColumn(i)}
                    className="p-1 text-archive hover:text-semantic-error transition-colors"
                    title="Remove column"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-archive mb-1">
                      Heading
                    </label>
                    <input
                      type="text"
                      value={col.heading}
                      onChange={(e) => updateFooterColumn(i, 'heading', e.target.value)}
                      placeholder="e.g. Visit Us"
                      className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-archive mb-1">
                      Type
                    </label>
                    <select
                      value={col.type}
                      onChange={(e) => updateFooterColumn(i, 'type', e.target.value)}
                      className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    >
                      {FOOTER_COLUMN_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-archive mb-1">
                    Content
                    {col.type === 'links' && (
                      <span className="ml-1 text-archive/70">
                        (one link per line: Label | URL)
                      </span>
                    )}
                    {col.type === 'hours' && (
                      <span className="ml-1 text-archive/70">
                        (one entry per line, e.g. Mon-Fri: 10am-5pm)
                      </span>
                    )}
                  </label>
                  <textarea
                    value={col.content}
                    onChange={(e) => updateFooterColumn(i, 'content', e.target.value)}
                    placeholder={
                      col.type === 'links'
                        ? 'About Us | /about\nContact | /contact'
                        : col.type === 'hours'
                          ? 'Mon-Fri: 10am-5pm\nSat-Sun: 11am-4pm'
                          : 'Enter text content...'
                    }
                    rows={4}
                    className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-y"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addFooterColumn}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-bark hover:text-copper-dark transition-colors"
          >
            <Plus size={14} />
            Add footer column
          </button>
        </div>

        {/* Land Acknowledgment */}
        <div>
          <label className="block text-xs font-medium text-ink mb-1">
            Land Acknowledgment
          </label>
          <textarea
            value={landAcknowledgment}
            onChange={(e) => {
              setLandAcknowledgment(e.target.value);
              setRichFooterDirty(true);
            }}
            placeholder="We acknowledge that our institution is located on the traditional lands of..."
            rows={4}
            className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-y"
          />
          <p className="text-xs text-archive mt-1">
            Displayed in a dedicated section at the bottom of the footer.
          </p>
        </div>
      </div>

      {/* Section: External Integrations (Phase 7) */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              External Integrations
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {integrationsSuccess && (
              <span className="text-sm text-semantic-success">{integrationsSuccess}</span>
            )}
            <button
              onClick={() => integrationsMutation.mutate()}
              disabled={!integrationsDirty || integrationsMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {integrationsMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        <p className="text-sm text-archive mb-6">
          Connect external services to display action buttons on your public
          site. Leave fields blank to hide a service.
        </p>

        <div className="space-y-6">
          {/* Ticketing */}
          <div className="border border-lichen rounded-lg p-4 bg-stone/20">
            <h4 className="text-xs font-medium text-ink uppercase tracking-wide mb-3">
              Ticketing
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-archive mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={integrations.ticketing.base_url ?? ''}
                  onChange={(e) => updateIntegration('ticketing', 'base_url', e.target.value)}
                  placeholder="https://tickets.example.com"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
              <div>
                <label className="block text-xs text-archive mb-1">
                  Button Text
                </label>
                <input
                  type="text"
                  value={integrations.ticketing.button_text}
                  onChange={(e) => updateIntegration('ticketing', 'button_text', e.target.value)}
                  placeholder="Buy Tickets"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>
          </div>

          {/* Membership */}
          <div className="border border-lichen rounded-lg p-4 bg-stone/20">
            <h4 className="text-xs font-medium text-ink uppercase tracking-wide mb-3">
              Membership
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-archive mb-1">
                  URL
                </label>
                <input
                  type="text"
                  value={integrations.membership.url ?? ''}
                  onChange={(e) => updateIntegration('membership', 'url', e.target.value)}
                  placeholder="https://membership.example.com"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
              <div>
                <label className="block text-xs text-archive mb-1">
                  Button Text
                </label>
                <input
                  type="text"
                  value={integrations.membership.button_text}
                  onChange={(e) => updateIntegration('membership', 'button_text', e.target.value)}
                  placeholder="Become a Member"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>
          </div>

          {/* Shop */}
          <div className="border border-lichen rounded-lg p-4 bg-stone/20">
            <h4 className="text-xs font-medium text-ink uppercase tracking-wide mb-3">
              Shop
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-archive mb-1">
                  URL
                </label>
                <input
                  type="text"
                  value={integrations.shop.url ?? ''}
                  onChange={(e) => updateIntegration('shop', 'url', e.target.value)}
                  placeholder="https://shop.example.com"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
              <div>
                <label className="block text-xs text-archive mb-1">
                  Button Text
                </label>
                <input
                  type="text"
                  value={integrations.shop.button_text}
                  onChange={(e) => updateIntegration('shop', 'button_text', e.target.value)}
                  placeholder="Visit Shop"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>
          </div>

          {/* Donate */}
          <div className="border border-lichen rounded-lg p-4 bg-stone/20">
            <h4 className="text-xs font-medium text-ink uppercase tracking-wide mb-3">
              Donate
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-archive mb-1">
                  URL
                </label>
                <input
                  type="text"
                  value={integrations.donate.url ?? ''}
                  onChange={(e) => updateIntegration('donate', 'url', e.target.value)}
                  placeholder="https://donate.example.com"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
              <div>
                <label className="block text-xs text-archive mb-1">
                  Button Text
                </label>
                <input
                  type="text"
                  value={integrations.donate.button_text}
                  onChange={(e) => updateIntegration('donate', 'button_text', e.target.value)}
                  placeholder="Support Us"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section: Analytics (Phase 8) */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Analytics
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {analyticsSuccess && (
              <span className="text-sm text-semantic-success">{analyticsSuccess}</span>
            )}
            <button
              onClick={() => analyticsMutation.mutate()}
              disabled={!analyticsDirty || analyticsMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {analyticsMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
          </div>
        </div>

        <p className="text-sm text-archive mb-6">
          Add analytics tracking to your public site. Tracking codes are
          injected into the site header for visitors only.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Google Analytics ID
            </label>
            <input
              type="text"
              value={analyticsConfig.ga_id}
              onChange={(e) => updateAnalytics('ga_id', e.target.value)}
              placeholder="G-XXXXXXXXXX"
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            <p className="text-xs text-archive mt-1">
              Your Google Analytics 4 measurement ID.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Google Tag Manager ID
            </label>
            <input
              type="text"
              value={analyticsConfig.gtm_id}
              onChange={(e) => updateAnalytics('gtm_id', e.target.value)}
              placeholder="GTM-XXXXXXX"
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink font-mono placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            <p className="text-xs text-archive mt-1">
              Your GTM container ID. If you use GTM, you may not need a separate
              GA ID.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Plausible Domain
            </label>
            <input
              type="text"
              value={analyticsConfig.plausible_domain}
              onChange={(e) => updateAnalytics('plausible_domain', e.target.value)}
              placeholder="yoursite.example.com"
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            <p className="text-xs text-archive mt-1">
              Domain registered with Plausible Analytics for privacy-friendly
              tracking.
            </p>
          </div>
        </div>
      </div>

      {/* Section: URL Redirects */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ArrowRight size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              URL Redirects
            </h3>
          </div>
        </div>

        <p className="text-sm text-archive mb-4">
          Manage URL redirects for your public site. Redirects are automatically
          created when you change a page slug.
        </p>

        <RedirectManager orgId={orgId!} />
      </div>

      {/* Section: CDN Cache Purging */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              CDN Cache Purging
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {cdnSuccess && (
              <span className="text-xs text-semantic-success">{cdnSuccess}</span>
            )}
            <button
              onClick={() => cdnMutation.mutate()}
              disabled={!cdnDirty || cdnMutation.isPending}
              className="btn-primary text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {cdnMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
        <p className="text-xs text-archive mb-4">
          When content is published or updated, the CDN cache is automatically purged
          so changes appear instantly. Configure your CDN provider below.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              CDN Provider
            </label>
            <select
              value={cdnConfig.provider}
              onChange={(e) => updateCdn('provider', e.target.value)}
              className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="">None (no CDN purging)</option>
              <option value="cloudflare">Cloudflare</option>
              <option value="cloudfront">CloudFront</option>
            </select>
          </div>

          {cdnConfig.provider === 'cloudflare' && (
            <>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Zone ID
                </label>
                <input
                  type="text"
                  value={cdnConfig.zone_id}
                  onChange={(e) => updateCdn('zone_id', e.target.value)}
                  placeholder="abc123..."
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
                <p className="text-xs text-archive mt-1">
                  Found in your Cloudflare dashboard under the domain&apos;s Overview tab.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  API Token
                </label>
                <input
                  type="password"
                  value={cdnConfig.api_token}
                  onChange={(e) => updateCdn('api_token', e.target.value)}
                  placeholder="Bearer token with Cache Purge permission"
                  className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
                <p className="text-xs text-archive mt-1">
                  Create an API token with &quot;Zone &gt; Cache Purge &gt; Purge&quot; permission.
                </p>
              </div>
            </>
          )}

          {cdnConfig.provider === 'cloudfront' && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Distribution ID
              </label>
              <input
                type="text"
                value={cdnConfig.distribution_id}
                onChange={(e) => updateCdn('distribution_id', e.target.value)}
                placeholder="E1ABC2DEF3GH4I"
                className="w-full border border-lichen rounded-lg px-3 py-2 text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
              <p className="text-xs text-archive mt-1">
                The CloudFront distribution ID. Authentication uses the server&apos;s IAM role
                or AWS environment variables.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Link to Discover settings (if available) */}
      {hasDiscover && (
        <div className="bg-parchment border border-lichen rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={18} className="text-bark" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
              Discover Settings
            </h3>
          </div>
          <p className="text-sm text-archive mb-4">
            Configure the collection browser, hero image, and scheduled
            publishing from the Discover settings page.
          </p>
          <Link
            to={`/organizations/${orgId}/collections/config/discover`}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-bark text-bark rounded-lg hover:bg-bark/5 transition-colors"
          >
            <Settings size={14} />
            Go to Discover Settings
          </Link>
        </div>
      )}

      {/* Media Picker for Footer Logo */}
      <MediaPickerModal
        isOpen={showFooterLogoPicker}
        onClose={() => setShowFooterLogoPicker(false)}
        onSelect={(mediaId) => {
          setFooterLogoMediaId(mediaId);
          setRichFooterDirty(true);
        }}
        organizationId={orgId!}
        mediaType="image"
      />
    </div>
  );
}
