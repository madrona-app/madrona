export const ROLE_LABELS: Record<string, string> = {
  creator: 'Creators',
  donor: 'Donors',
  previous_owner: 'Previous Owners',
  depicted: 'Depicted',
  associated: 'Associated',
};

export const ROLE_OPTIONS = [
  { value: 'creator', label: 'Creator' },
  { value: 'donor', label: 'Donor' },
  { value: 'previous_owner', label: 'Previous Owner' },
  { value: 'depicted', label: 'Depicted' },
  { value: 'associated', label: 'Associated' },
];

export const QUALIFIER_SUGGESTIONS = [
  'attributed to',
  'circle of',
  'after',
  'school of',
  'follower of',
  'workshop of',
  'manner of',
  'studio of',
];

export const CERTAINTY_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'certain', label: 'Certain' },
  { value: 'probable', label: 'Probable' },
  { value: 'possible', label: 'Possible' },
];

export const LIFE_ROLE_OPTIONS = [
  { value: 'artist', label: 'Artist' },
  { value: 'painter', label: 'Painter' },
  { value: 'sculptor', label: 'Sculptor' },
  { value: 'photographer', label: 'Photographer' },
  { value: 'printmaker', label: 'Printmaker' },
  { value: 'architect', label: 'Architect' },
  { value: 'designer', label: 'Designer' },
  { value: 'craftsperson', label: 'Craftsperson' },
  { value: 'collector', label: 'Collector' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'patron', label: 'Patron' },
  { value: 'author', label: 'Author' },
  { value: 'other', label: 'Other' },
];

export const ROLE_ORDER = ['creator', 'donor', 'previous_owner', 'depicted', 'associated'];
