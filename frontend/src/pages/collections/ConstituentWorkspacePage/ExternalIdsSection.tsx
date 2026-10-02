import { Globe, Search, ExternalLink, X, Loader2 } from 'lucide-react';
import {
  WorkspaceSection,
} from '../../../components/workspace';
import type { BaseSectionProps } from './types';
import type { useUlanSearch, useAuthoritySearch } from './hooks';

interface ExternalIdsSectionProps extends BaseSectionProps {
  ulan: ReturnType<typeof useUlanSearch>;
  authority: ReturnType<typeof useAuthoritySearch>;
}

interface AuthorityCardProps {
  label: string;
  id: string;
  displayName: string;
  externalUrl: string;
  externalLabel: string;
  isEditing: boolean;
  onSearch: () => void;
  onClear: () => void;
}

function AuthorityCard({ label, id, displayName, externalUrl, externalLabel, isEditing, onSearch, onClear }: AuthorityCardProps) {
  if (!id) {
    // Not linked
    return (
      <div className="p-4 border border-dashed border-lichen rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="text-xs text-archive mt-0.5">Not linked</p>
          </div>
          {isEditing && (
            <button
              type="button"
              onClick={onSearch}
              className="btn btn-secondary text-sm"
            >
              <Search size={14} className="mr-1" />
              Search
            </button>
          )}
        </div>
      </div>
    );
  }

  // Linked — show name prominently, ID as secondary
  return (
    <div className="p-4 border border-lichen rounded-lg bg-parchment">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">
            {displayName || id}
          </p>
          {displayName && (
            <p className="text-xs text-archive mt-0.5 font-mono">{id}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-forest/10 text-forest font-medium">
              {label}
            </span>
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark transition-colors"
            >
              <ExternalLink size={12} />
              {externalLabel}
            </a>
          </div>
        </div>
        {isEditing && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSearch}
              className="text-xs text-bark hover:text-copper-dark transition-colors"
            >
              Change
            </button>
            <button
              type="button"
              onClick={onClear}
              className="p-1 text-archive hover:text-semantic-error transition-colors"
              title="Remove"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ExternalIdsSection({
  isEditing,
  formData,
  updateField,
  handleFieldBlur,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty: _isEmpty,
  sectionSummaries,
  ulan,
  authority,
}: ExternalIdsSectionProps) {
  const hasAny = !!(formData.ulan_id || formData.viaf_id || formData.wikidata_id || formData.loc_id);

  return (
    <WorkspaceSection
      id="external"
      title="Authority Links"
      icon={<Globe size={18} />}
      isExpanded={expandedSections.external}
      onToggle={() => toggleSection('external')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['external'] = el; }}
      order={getSectionOrder('external')}
      isEmpty={!hasAny}
      sectionHint={sectionSummaries?.external}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AuthorityCard
          label="ULAN"
          id={formData.ulan_id}
          displayName={formData.ulan_label || formData.display_name || ''}
          externalUrl={`http://vocab.getty.edu/ulan/${formData.ulan_id}`}
          externalLabel="View in Getty"
          isEditing={isEditing}
          onSearch={ulan.openUlanSearch}
          onClear={() => { updateField('ulan_id', ''); updateField('ulan_label', ''); handleFieldBlur(); }}
        />
        <AuthorityCard
          label="VIAF"
          id={formData.viaf_id}
          displayName={formData.viaf_label}
          externalUrl={`https://viaf.org/viaf/${formData.viaf_id}`}
          externalLabel="View in VIAF"
          isEditing={isEditing}
          onSearch={() => authority.openAuthoritySearch('viaf')}
          onClear={() => { updateField('viaf_id', ''); updateField('viaf_label', ''); handleFieldBlur(); }}
        />
        <AuthorityCard
          label="Wikidata"
          id={formData.wikidata_id}
          displayName={formData.wikidata_label}
          externalUrl={`https://www.wikidata.org/wiki/${formData.wikidata_id}`}
          externalLabel="View in Wikidata"
          isEditing={isEditing}
          onSearch={() => authority.openAuthoritySearch('wikidata')}
          onClear={() => { updateField('wikidata_id', ''); updateField('wikidata_label', ''); handleFieldBlur(); }}
        />
        <AuthorityCard
          label="Library of Congress"
          id={formData.loc_id}
          displayName={formData.loc_label}
          externalUrl={`https://id.loc.gov/authorities/names/${formData.loc_id}`}
          externalLabel="View in LoC"
          isEditing={isEditing}
          onSearch={() => authority.openAuthoritySearch('loc')}
          onClear={() => { updateField('loc_id', ''); updateField('loc_label', ''); handleFieldBlur(); }}
        />
      </div>

      {/* ULAN Search Dialog */}
      {ulan.ulanSearchOpen && <UlanSearchDialog ulan={ulan} />}

      {/* Authority Search Dialog (VIAF, Wikidata, LoC) */}
      {authority.authoritySearchOpen && <AuthoritySearchDialog authority={authority} />}
    </WorkspaceSection>
  );
}


function UlanSearchDialog({ ulan }: { ulan: ReturnType<typeof useUlanSearch> }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="fixed inset-0 bg-ink/40" onClick={() => ulan.setUlanSearchOpen(false)} />
      <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-lichen">
          <h3 className="text-base font-medium text-ink">Search Getty ULAN</h3>
          <button type="button" onClick={() => ulan.setUlanSearchOpen(false)} className="p-1 text-archive hover:text-ink transition-colors"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 border-b border-lichen">
          <form onSubmit={(e) => { e.preventDefault(); ulan.handleUlanSearch(); }} className="flex gap-2">
            <input type="text" value={ulan.ulanQuery} onChange={(e) => ulan.setUlanQuery(e.target.value)} placeholder="Search by name..." className="flex-1 px-3 py-2 text-sm border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2" autoFocus />
            <button type="submit" disabled={ulan.ulanSearching || ulan.ulanQuery.trim().length < 2} className="btn btn-primary text-sm disabled:opacity-50">
              {ulan.ulanSearching ? <Loader2 size={16} className="animate-spin" /> : 'Search'}
            </button>
          </form>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {ulan.ulanPreview ? (
            <div className="space-y-4">
              <button type="button" onClick={() => ulan.setUlanPreview(null)} className="text-sm text-bark hover:text-copper-dark transition-colors">&larr; Back to results</button>
              <div className="border border-lichen rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-ink">{ulan.ulanPreview.preferred_name || ulan.ulanPreview.display_name}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {ulan.ulanPreview.nationality && <div><span className="text-archive">Nationality:</span> {ulan.ulanPreview.nationality}</div>}
                  {ulan.ulanPreview.gender && <div><span className="text-archive">Gender:</span> {ulan.ulanPreview.gender}</div>}
                  {ulan.ulanPreview.birth_date_display && <div><span className="text-archive">Born:</span> {ulan.ulanPreview.birth_date_display}{ulan.ulanPreview.birth_place ? `, ${ulan.ulanPreview.birth_place}` : ''}</div>}
                  {ulan.ulanPreview.death_date_display && <div><span className="text-archive">Died:</span> {ulan.ulanPreview.death_date_display}{ulan.ulanPreview.death_place ? `, ${ulan.ulanPreview.death_place}` : ''}</div>}
                  {ulan.ulanPreview.life_roles?.length ? <div className="col-span-2"><span className="text-archive">Roles:</span> {ulan.ulanPreview.life_roles.join(', ')}</div> : null}
                </div>
                {ulan.ulanPreview.biography && <p className="text-sm text-archive">{ulan.ulanPreview.biography}</p>}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => ulan.handleUlanApply(true)} className="btn btn-primary text-sm">Apply ID + Enrich Fields</button>
                <button type="button" onClick={() => ulan.handleUlanApply(false)} className="btn btn-secondary text-sm">Apply ID Only</button>
              </div>
            </div>
          ) : ulan.ulanLoadingPreview ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-archive" /><span className="ml-2 text-sm text-archive">Loading ULAN record...</span></div>
          ) : ulan.ulanResults.length > 0 ? (
            <ul className="divide-y divide-lichen">
              {ulan.ulanResults.map((r) => (
                <li key={r.ulan_id}>
                  <button type="button" onClick={() => ulan.handleUlanSelect(r.ulan_id)} className="w-full text-left px-3 py-3 hover:bg-stone/30 transition-colors rounded">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{r.label}</span>
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-stone text-archive rounded">ULAN</span>
                    </div>
                    <div className="text-xs text-archive mt-0.5">{[r.dates, r.nationality, r.description].filter(Boolean).join(' · ')}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : ulan.ulanSearching ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-archive" /><span className="ml-2 text-sm text-archive">Searching ULAN...</span></div>
          ) : ulan.ulanQuery.trim().length >= 2 ? (
            <p className="text-sm text-archive py-8 text-center">No results found.</p>
          ) : (
            <p className="text-sm text-archive py-8 text-center">Enter a name to search the Getty ULAN.</p>
          )}
        </div>
      </div>
    </div>
  );
}


function AuthoritySearchDialog({ authority }: { authority: ReturnType<typeof useAuthoritySearch> }) {
  const labelMap = { viaf: 'VIAF', wikidata: 'Wikidata', loc: 'Library of Congress' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="fixed inset-0 bg-ink/40" onClick={() => authority.setAuthoritySearchOpen(null)} />
      <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-lichen">
          <h3 className="text-base font-medium text-ink">Search {labelMap[authority.authoritySearchOpen!]}</h3>
          <button type="button" onClick={() => authority.setAuthoritySearchOpen(null)} className="p-1 text-archive hover:text-ink transition-colors"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 border-b border-lichen">
          <form onSubmit={(e) => { e.preventDefault(); authority.handleAuthoritySearch(); }} className="flex gap-2">
            <input type="text" value={authority.authorityQuery} onChange={(e) => authority.setAuthorityQuery(e.target.value)} placeholder="Search by name..." className="flex-1 px-3 py-2 text-sm border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2" autoFocus />
            <button type="submit" disabled={authority.authoritySearching || authority.authorityQuery.trim().length < 2} className="btn btn-primary text-sm disabled:opacity-50">
              {authority.authoritySearching ? <Loader2 size={16} className="animate-spin" /> : 'Search'}
            </button>
          </form>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {authority.authorityResults.length > 0 ? (
            <ul className="divide-y divide-lichen">
              {authority.authorityResults.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => authority.handleAuthoritySelect(r)} className="w-full text-left px-3 py-3 hover:bg-stone/30 transition-colors rounded">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{r.label}</span>
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-stone text-archive rounded">{r.authority_id}</span>
                    </div>
                    {r.description && <div className="text-xs text-archive mt-0.5">{r.description}</div>}
                  </button>
                </li>
              ))}
            </ul>
          ) : authority.authoritySearching ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-archive" /><span className="ml-2 text-sm text-archive">Searching...</span></div>
          ) : authority.authorityQuery.trim().length >= 2 ? (
            <p className="text-sm text-archive py-8 text-center">No results found.</p>
          ) : (
            <p className="text-sm text-archive py-8 text-center">Enter a name to search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
