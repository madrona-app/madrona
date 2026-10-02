/**
 * Guide widget page: visitor-widget settings + embed code.
 *
 * The public widget is off by default — this page is where an org admin
 * turns it on, sets the welcome message, and watches the monthly meter.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Code2, Copy, MessageSquare } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { getWidgetSettings, updateWidgetSettings } from '../../lib/api/guideWidget';

const WELCOME_MAX = 300;

export default function GuideWidgetPage() {
  const { activeOrganization } = useOrganization();
  const [copied, setCopied] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [welcome, setWelcome] = useState('');
  const [dirty, setDirty] = useState(false);

  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['guide-widget-settings'],
    queryFn: getWidgetSettings,
  });

  useEffect(() => {
    if (settingsQuery.data && !dirty) {
      setEnabled(settingsQuery.data.enabled);
      setWelcome(settingsQuery.data.welcome_message ?? '');
    }
  }, [settingsQuery.data, dirty]);

  const saveMutation = useMutation({
    mutationFn: () => updateWidgetSettings({ enabled, welcome_message: welcome || null }),
    onSuccess: (data) => {
      queryClient.setQueryData(['guide-widget-settings'], data);
      setDirty(false);
    },
  });

  const orgSlug = activeOrganization?.organization_slug || 'your-museum';
  // Where the embeddable widget script is hosted is a deployment decision —
  // it is not served by this app — so it comes from configuration. Unset,
  // there is no script to point at, and handing out a snippet anyway would
  // embed someone else's server in a museum's website.
  const widgetScriptUrl = (import.meta.env.VITE_GUIDE_WIDGET_URL as string | undefined)?.trim();
  const embedCode = widgetScriptUrl
    ? `<script src="${widgetScriptUrl}" data-org="${orgSlug}"></script>`
    : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const settings = settingsQuery.data;
  const used = settings?.widget_queries_this_month ?? 0;
  const cap = settings?.max_widget_queries ?? null;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : null;
  const atCap = cap !== null && used >= cap;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">Widget & Embed</h1>
        <p className="text-sm text-archive mt-1">
          Add a chat widget to your museum's website so visitors can ask questions.
        </p>
      </div>

      {/* Visitor widget settings */}
      <section className="border border-lichen rounded-lg p-6 bg-parchment mb-6">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-5 h-5 text-bark" />
          <h2 className="font-semibold text-ink">Visitor widget</h2>
        </div>

        {settingsQuery.isLoading ? (
          <p className="text-sm text-archive">Loading settings…</p>
        ) : settingsQuery.isError ? (
          <p className="text-sm text-semantic-error">Could not load widget settings.</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-ink">Enable on your public collection site</p>
                <p className="text-sm text-archive mt-0.5">
                  When off, the chat widget is hidden and visitor requests are refused.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label="Enable visitor widget"
                onClick={() => { setEnabled(v => !v); setDirty(true); }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 ring-bark/30 ring-offset-2 ${
                  enabled ? 'bg-azurite' : 'bg-stone'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-parchment-warm transition-transform ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div>
              <label htmlFor="widget-welcome" className="block text-sm font-medium text-ink mb-1">
                Welcome message
              </label>
              <textarea
                id="widget-welcome"
                value={welcome}
                onChange={(e) => { setWelcome(e.target.value.slice(0, WELCOME_MAX)); setDirty(true); }}
                rows={2}
                maxLength={WELCOME_MAX}
                placeholder="Hi! Ask me anything about the collection, exhibitions, or your visit."
                className="w-full rounded-md border border-lichen bg-parchment-warm px-3 py-2 text-sm text-ink placeholder:text-archive focus-visible:ring-2 ring-bark/30 ring-offset-2 focus:outline-none"
              />
              <p className="text-xs text-archive mt-1">{welcome.length}/{WELCOME_MAX} — shown as the first bubble when a visitor opens the chat.</p>
            </div>

            {/* Usage meter */}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-sm font-medium text-ink">Monthly visitor queries</p>
                <p className={`text-sm ${atCap ? 'text-semantic-error font-medium' : 'text-archive'}`}>
                  {used.toLocaleString()}{cap !== null ? ` / ${cap.toLocaleString()}` : ' (unmetered)'}
                </p>
              </div>
              {pct !== null && (
                <div className="h-2 rounded-full bg-stone overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className={`h-full rounded-full transition-all ${atCap ? 'bg-semantic-error' : 'bg-azurite'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {atCap && (
                <p className="text-xs text-semantic-error mt-1">
                  Limit reached — visitors will see a friendly unavailable message until next month or an upgraded plan.
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={!dirty || saveMutation.isPending}
                className="btn-primary disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
              {saveMutation.isError && (
                <span className="text-sm text-semantic-error">Save failed — try again.</span>
              )}
              {!dirty && saveMutation.isSuccess && (
                <span className="text-sm text-semantic-success">Saved.</span>
              )}
            </div>

            <p className="text-xs text-archive">
              The widget inherits your Discover site's theme color. Changes appear on the public site within a few seconds.
            </p>
          </div>
        )}
      </section>

      {/* Embed code */}
      <section className="border border-lichen rounded-lg p-6 bg-parchment mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Code2 className="w-5 h-5 text-bark" />
          <h2 className="font-semibold text-ink">Embed code</h2>
        </div>
        <p className="text-sm text-archive mb-4">
          Paste this script tag before the closing <code className="text-xs bg-stone/30 px-1.5 py-0.5 rounded">&lt;/body&gt;</code> tag on your website.
          The widget creates a floating chat button in the bottom-right corner.
        </p>
        {embedCode ? (
          <div className="relative">
            <pre className="bg-forest text-parchment rounded-md p-4 text-sm overflow-x-auto">
              {embedCode}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 text-parchment/70 hover:text-parchment transition-colors p-1.5"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <p className="text-sm text-archive" role="status">
            No widget script is configured for this deployment. Set{' '}
            <code className="text-xs bg-stone/30 px-1.5 py-0.5 rounded">VITE_GUIDE_WIDGET_URL</code>{' '}
            to where the widget script is hosted to get an embed code.
          </p>
        )}
      </section>

      {/* How it works */}
      <section className="border border-lichen rounded-lg p-6 bg-parchment">
        <h2 className="font-semibold text-ink mb-3">How it works</h2>
        <ol className="space-y-3 text-sm text-accessible-gray">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bark/10 text-bark flex items-center justify-center text-xs font-semibold">1</span>
            <span>Visitors see a chat button on your website.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bark/10 text-bark flex items-center justify-center text-xs font-semibold">2</span>
            <span>They ask questions about your museum — hours, exhibitions, collection, policies.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bark/10 text-bark flex items-center justify-center text-xs font-semibold">3</span>
            <span>The assistant answers using your collection data, exhibitions, events, and any documents you've uploaded and marked as <strong>public</strong>.</span>
          </li>
        </ol>
      </section>
    </div>
  );
}
