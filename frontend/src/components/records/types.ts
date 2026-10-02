import type { ReactNode, Dispatch, SetStateAction } from 'react';

export interface MetadataFieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'radio-cards';
  options?: { value: string; label: string; description?: string }[];
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  helpText?: string;
  /** Only show this field after a search item is selected */
  showAfterSelection?: boolean;
}

export interface SearchConfig<TSearch> {
  title: string;
  subtitle?: string;
  placeholder?: string;
  searchLabel?: string;
  minSearchLength?: number;
  noResultsMessage?: string;
  /** Base query key for react-query (search term is appended) */
  queryKey: string[];
  searchFn: (term: string) => Promise<TSearch[]>;
  getSearchItemId: (item: TSearch) => string;
  getSearchItemLabel: (item: TSearch) => string;
  renderSearchItem: (item: TSearch, isSelected: boolean) => ReactNode;
  /** Custom filter to remove already-linked items from results.
   *  If not provided, filters by checking getSearchItemId against linkedIds. */
  filterLinked?: (items: TSearch[], linkedIds: Set<string>) => TSearch[];
}

export interface CreateConfig {
  /** Label for the create button (e.g., "Create New Person or Organization") */
  label: string;
  /** Submit button text in create mode (e.g., "Create & Link") */
  submitLabel?: string;
  /** Render create form fields. Update formData via setFormData. */
  renderCreateFields: (props: {
    searchTerm: string;
    formData: Record<string, any>;
    setFormData: Dispatch<SetStateAction<Record<string, any>>>;
    metadata: Record<string, any>;
  }) => ReactNode;
  /** Called when the user submits the create form */
  onCreateSubmit: (formData: Record<string, any>, metadata: Record<string, any>) => Promise<void>;
  /** Determine if the create form can be submitted */
  canSubmit?: (formData: Record<string, any>) => boolean;
}

export interface RemoteCacheConfig<TSearch> {
  /** Whether this search item is a remote/uncached item */
  isRemote: (item: TSearch) => boolean;
  /** Badge label for remote items (e.g., "ULAN", "AAT") */
  remoteLabel?: string;
  /** Submit button text when a remote item is selected (e.g., "Import & Add") */
  importButtonLabel?: string;
  /** Label shown in the selected indicator for remote items */
  selectedRemoteText?: string;
}
