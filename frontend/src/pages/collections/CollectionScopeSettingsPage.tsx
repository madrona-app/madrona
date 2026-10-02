import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Library, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import {
  getCollectionProfile,
  updateCollectionProfile,
  type CollectionProfile,
} from '../../lib/api';
import { useOrganization } from '../../contexts/useOrganization';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const COMPLETENESS_OPTIONS = ['comprehensive', 'representative', 'partial', 'unknown'] as const;
const DIGITIZATION_OPTIONS = ['full', 'partial', 'minimal', 'none', 'unknown'] as const;

type CoverageState = {
  date_range: string;
  record_types: string;
  geography: string;
  languages: string;
};

function coverageToState(coverage: CollectionProfile['coverage']): CoverageState {
  const c = (coverage || {}) as Record<string, unknown>;
  const asText = (v: unknown) =>
    Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
  return {
    date_range: asText(c.date_range),
    record_types: asText(c.record_types),
    geography: asText(c.geography),
    languages: asText(c.languages),
  };
}

function stateToCoverage(s: CoverageState): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (s.date_range.trim()) out.date_range = s.date_range.trim();
  if (s.record_types.trim()) {
    out.record_types = s.record_types.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (s.geography.trim()) out.geography = s.geography.trim();
  if (s.languages.trim()) out.languages = s.languages.trim();
  return Object.keys(out).length ? out : null;
}

export default function CollectionScopeSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();

  const [scopeNote, setScopeNote] = useState('');
  const [coverage, setCoverage] = useState<CoverageState>({
    date_range: '', record_types: '', geography: '', languages: '',
  });
  const [completeness, setCompleteness] = useState('');
  const [extentNote, setExtentNote] = useState('');
  const [knownGaps, setKnownGaps] = useState('');
  const [digitizationStatus, setDigitizationStatus] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['collection-profile', organizationId],
    queryFn: () => {
      if (!organizationId) throw new Error('No organization selected');
      return getCollectionProfile(organizationId);
    },
    enabled: !!organizationId,
  });

  useEffect(() => {
    if (profile) {
      setScopeNote(profile.scope_note || '');
      setCoverage(coverageToState(profile.coverage));
      setCompleteness(profile.completeness || '');
      setExtentNote(profile.extent_note || '');
      setKnownGaps(profile.known_gaps || '');
      setDigitizationStatus(profile.digitization_status || '');
      setHasChanges(false);
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<CollectionProfile>) => {
      if (!organizationId) throw new Error('No organization selected');
      return updateCollectionProfile(organizationId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-profile', organizationId] });
      setHasChanges(false);
    },
  });

  const touched = () => setHasChanges(true);

  const handleSave = () => {
    updateMutation.mutate({
      scope_note: scopeNote.trim() || null,
      coverage: stateToCoverage(coverage),
      completeness: completeness || null,
      extent_note: extentNote.trim() || null,
      known_gaps: knownGaps.trim() || null,
      digitization_status: digitizationStatus || null,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading collection scope…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-semantic-error p-4">
        <AlertCircle size={18} />
        <span>Could not load the collection scope profile.</span>
      </div>
    );
  }

  const labelCls = 'block text-sm font-medium text-ink mb-1';
  const inputCls =
    'w-full rounded-md border border-lichen bg-parchment-warm px-3 py-2 text-ink ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

  return (
    <div className="max-w-3xl">
      <div className="flex items-start gap-3 mb-2">
        <Library size={22} className="text-forest mt-1" />
        <div>
          <h1 className="text-xl font-serif font-semibold text-ink">Collection Scope</h1>
          <p className="text-sm text-archive mt-1">
            Describe what this collection covers and where it's incomplete. The Guide uses this to
            answer coverage questions and to disclose partial digitization and known gaps — so it
            never presents partial holdings as comprehensive.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5 mt-6">
        <div>
          <label htmlFor="scope_note" className={labelCls}>Scope &amp; content</label>
          <textarea
            id="scope_note" rows={3} className={inputCls} value={scopeNote}
            onChange={(e) => { setScopeNote(e.target.value); touched(); }}
            placeholder="e.g. Regional fine art and decorative arts, with strengths in 19th-century landscape painting."
          />
        </div>

        <fieldset className="border border-lichen rounded-md p-4">
          <legend className="px-1 text-sm font-medium text-ink">Coverage</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cov_dates" className={labelCls}>Date range</label>
              <input id="cov_dates" className={inputCls} value={coverage.date_range}
                onChange={(e) => { setCoverage({ ...coverage, date_range: e.target.value }); touched(); }}
                placeholder="1850–1950" />
            </div>
            <div>
              <label htmlFor="cov_types" className={labelCls}>Record / object types</label>
              <input id="cov_types" className={inputCls} value={coverage.record_types}
                onChange={(e) => { setCoverage({ ...coverage, record_types: e.target.value }); touched(); }}
                placeholder="paintings, prints, photographs" />
            </div>
            <div>
              <label htmlFor="cov_geo" className={labelCls}>Geography</label>
              <input id="cov_geo" className={inputCls} value={coverage.geography}
                onChange={(e) => { setCoverage({ ...coverage, geography: e.target.value }); touched(); }}
                placeholder="Pacific Northwest" />
            </div>
            <div>
              <label htmlFor="cov_langs" className={labelCls}>Languages</label>
              <input id="cov_langs" className={inputCls} value={coverage.languages}
                onChange={(e) => { setCoverage({ ...coverage, languages: e.target.value }); touched(); }}
                placeholder="English, French" />
            </div>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="completeness" className={labelCls}>Completeness</label>
            <select id="completeness" className={inputCls} value={completeness}
              onChange={(e) => { setCompleteness(e.target.value); touched(); }}>
              <option value="">— not stated —</option>
              {COMPLETENESS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="digitization" className={labelCls}>Digitization status</label>
            <select id="digitization" className={inputCls} value={digitizationStatus}
              onChange={(e) => { setDigitizationStatus(e.target.value); touched(); }}>
              <option value="">— not stated —</option>
              {DIGITIZATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="extent_note" className={labelCls}>Extent note</label>
          <textarea id="extent_note" rows={2} className={inputCls} value={extentNote}
            onChange={(e) => { setExtentNote(e.target.value); touched(); }}
            placeholder="e.g. ~4,000 of an estimated 12,000 objects cataloged." />
        </div>

        <div>
          <label htmlFor="known_gaps" className={labelCls}>Known gaps &amp; exclusions</label>
          <textarea id="known_gaps" rows={3} className={inputCls} value={knownGaps}
            onChange={(e) => { setKnownGaps(e.target.value); touched(); }}
            placeholder="What's missing or excluded, and why (e.g. works on paper not yet digitized; no provenance for WWII-era acquisitions)." />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="button" className="btn-primary" onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 size={16} className="animate-spin mr-2 inline" />}
            Save
          </button>
          {updateMutation.isSuccess && !hasChanges && (
            <span className="flex items-center gap-1 text-sm text-semantic-success">
              <CheckCircle size={16} /> Saved
            </span>
          )}
          {updateMutation.isError && (
            <span className="flex items-center gap-1 text-sm text-semantic-error">
              <AlertCircle size={16} /> Could not save
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
