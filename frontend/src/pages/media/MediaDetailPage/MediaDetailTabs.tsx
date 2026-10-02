import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Info, Layers, Database, Sparkles, Files, Crop,
  MousePointerSquareDashed, Shield, ShieldCheck,
  History, MessageSquare, MoreHorizontal, ChevronDown,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { TabKey, SubRouteTabKey } from './types';
import type { RightsStatusInfo } from './types';
import { SUB_ROUTE_TABS } from './types';
import { useAuth } from '../../../hooks/useAuth';

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  mediaTypes?: readonly string[];
  overflow?: boolean;
}

const ALL_TABS: readonly TabConfig[] = [
  { key: 'details', label: 'Details', icon: Info },
  { key: 'derivatives', label: 'Derivatives', icon: Layers },
  { key: 'metadata', label: 'Technical', icon: Database },
  { key: 'ai', label: 'AI', icon: Sparkles },
  { key: 'alternatives', label: 'Files', icon: Files },
  { key: 'transform', label: 'Transform', icon: Crop, mediaTypes: ['image'] },
  { key: 'annotations', label: 'Annotations', icon: MousePointerSquareDashed, mediaTypes: ['image'] },
  { key: 'rights', label: 'Rights', icon: Shield },
  // Less frequently used — grouped under "More"
  { key: 'preservation', label: 'Preservation', icon: ShieldCheck, overflow: true },
  { key: 'history', label: 'History', icon: History, overflow: true },
  { key: 'discussion', label: 'Notes', icon: MessageSquare, overflow: true },
] as const;

export { ALL_TABS };

export function MediaDetailTabs({
  mediaType,
  activeTab,
  onTabChange,
  rightsStatus,
  basePath,
}: {
  mediaType: string;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  rightsStatus: RightsStatusInfo;
  basePath: string;
}) {
  const { user } = useAuth();
  const aiTaggingEnabled = user?.ai_tagging_enabled !== false;
  const transcriptionEnabled = user?.transcription_enabled !== false;

  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [labelsToShow, setLabelsToShow] = useState(Infinity);
  const moreRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  const filterByType = (tab: TabConfig) => {
    if (tab.mediaTypes) {
      return tab.mediaTypes.includes(mediaType);
    }
    return true;
  };

  // The AI tab offers auto-tagging and transcription, both deployment
  // capabilities that are off unless a model is configured. With neither
  // available the tab opens onto controls whose jobs never run, so drop it.
  const filterByCapability = (tab: TabConfig) => {
    if (tab.key !== 'ai') return true;
    const canTranscribe = transcriptionEnabled && (mediaType === 'video' || mediaType === 'audio');
    return aiTaggingEnabled || canTranscribe;
  };

  const filteredTabs = ALL_TABS.filter(filterByType).filter(filterByCapability);
  const primaryTabs = filteredTabs.filter((t) => !t.overflow);
  const overflowTabs = filteredTabs.filter((t) => t.overflow);
  const activeOverflowTab = overflowTabs.find((t) => t.key === activeTab);

  // Progressive label collapse
  const wrapperRef = useRef<HTMLDivElement>(null);
  const withLabelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const iconOnlyRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const moreRulerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const check = () => {
      const available = wrapper.clientWidth;
      const moreW = moreRulerRef.current?.offsetWidth ?? 60;
      const count = primaryTabs.length;
      for (let labeled = count; labeled >= 0; labeled--) {
        let total = moreW;
        let fits = true;
        for (let i = 0; i < count; i++) {
          const ref = i < labeled ? withLabelRefs.current[i] : iconOnlyRefs.current[i];
          total += ref?.offsetWidth ?? 0;
          if (total > available) { fits = false; break; }
        }
        if (fits) {
          setLabelsToShow(labeled);
          return;
        }
      }
      setLabelsToShow(0);
    };

    const observer = new ResizeObserver(check);
    observer.observe(wrapper);
    check();
    return () => observer.disconnect();
  }, [primaryTabs.length]);

  const isTabActive = (tab: TabConfig) => {
    if (tab.key in SUB_ROUTE_TABS) {
      const subPath = `${basePath}/${SUB_ROUTE_TABS[tab.key as SubRouteTabKey]}`;
      return location.pathname === subPath;
    }
    return activeTab === tab.key && !location.pathname.includes('/', basePath.length + 1);
  };

  const renderTab = (tab: TabConfig, _index: number, hasLabel: boolean) => {
    const TabIcon = tab.icon;
    const active = isTabActive(tab);
    const isSubRoute = tab.key in SUB_ROUTE_TABS;

    const className = cn(
      'flex items-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
      hasLabel ? 'px-3.5' : 'px-2.5',
      active
        ? 'border-bark text-bark'
        : 'border-transparent text-archive hover:text-ink hover:border-lichen'
    );

    const content = (
      <>
        <TabIcon size={16} />
        {hasLabel && tab.label}
        {tab.key === 'rights' && (
          <span
            className={cn('w-2 h-2 rounded-full', rightsStatus.dotColor)}
            title={rightsStatus.label}
          />
        )}
      </>
    );

    if (isSubRoute) {
      return (
        <Link
          key={tab.key}
          to={`${basePath}/${SUB_ROUTE_TABS[tab.key as SubRouteTabKey]}`}
          title={tab.label}
          className={className}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        key={tab.key}
        onClick={() => onTabChange(tab.key)}
        title={tab.label}
        className={className}
      >
        {content}
      </button>
    );
  };

  const renderOverflowTab = (tab: TabConfig) => {
    const TabIcon = tab.icon;
    const active = isTabActive(tab);
    const isSubRoute = tab.key in SUB_ROUTE_TABS;

    const className = cn(
      'flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-colors',
      active
        ? 'text-bark bg-bark/5 font-medium'
        : 'text-ink hover:bg-stone/30'
    );

    const content = (
      <>
        <TabIcon size={16} className="flex-shrink-0" />
        {tab.label}
      </>
    );

    if (isSubRoute) {
      return (
        <Link
          key={tab.key}
          to={`${basePath}/${SUB_ROUTE_TABS[tab.key as SubRouteTabKey]}`}
          className={className}
          onClick={() => setMoreOpen(false)}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        key={tab.key}
        onClick={() => {
          onTabChange(tab.key);
          setMoreOpen(false);
        }}
        className={className}
      >
        {content}
      </button>
    );
  };

  return (
    <div ref={wrapperRef} className="border-b border-lichen relative">
      {/* Hidden measurement elements */}
      <div aria-hidden className="absolute top-0 left-0 flex items-center pointer-events-none" style={{ visibility: 'hidden', height: 0, overflow: 'hidden' }}>
        {primaryTabs.map((tab, i) => {
          const TabIcon = tab.icon;
          return (
            <span key={`wl-${tab.key}`} ref={(el) => { withLabelRefs.current[i] = el; }} className="inline-flex items-center gap-1.5 px-3.5 py-3 text-sm font-medium whitespace-nowrap">
              <TabIcon size={16} />{tab.label}
            </span>
          );
        })}
        {primaryTabs.map((tab, i) => {
          const TabIcon = tab.icon;
          return (
            <span key={`io-${tab.key}`} ref={(el) => { iconOnlyRefs.current[i] = el; }} className="inline-flex items-center px-2.5 py-3">
              <TabIcon size={16} />
            </span>
          );
        })}
        <span ref={moreRulerRef} className="inline-flex items-center gap-1.5 px-3.5 py-3 text-sm font-medium whitespace-nowrap">
          <MoreHorizontal size={16} />More<ChevronDown size={14} />
        </span>
      </div>

      <nav ref={navRef} className="flex items-center -mb-px">
        {primaryTabs.map((tab, i) => renderTab(tab, i, i < labelsToShow))}

        {overflowTabs.length > 0 && (
          <div className="relative ml-auto" ref={moreRef}>
            <button
              onClick={() => setMoreOpen((o) => !o)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeOverflowTab
                  ? 'border-bark text-bark'
                  : 'border-transparent text-archive hover:text-ink hover:border-lichen'
              )}
            >
              {activeOverflowTab ? (
                <>
                  {(() => { const I = activeOverflowTab.icon; return <I size={16} />; })()}
                  {labelsToShow > 0 && activeOverflowTab.label}
                </>
              ) : (
                <>
                  <MoreHorizontal size={16} />
                  {labelsToShow > 0 && 'More'}
                </>
              )}
              <ChevronDown size={14} className={cn('transition-transform', moreOpen && 'rotate-180')} />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-parchment border border-lichen rounded-lg shadow-lg py-1 min-w-[200px]">
                {overflowTabs.map(renderOverflowTab)}
              </div>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
