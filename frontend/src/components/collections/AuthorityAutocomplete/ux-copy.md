# UX Copy Guide: Authority Autocomplete

User-facing text for the authority-aware autocomplete component. All copy avoids technical jargon like "URI", "authority", "linked data", or "LOD".

---

## Input Placeholders

| Field Type | Placeholder |
|------------|-------------|
| Creator | "Search for artist or maker..." |
| Material | "Search for material..." |
| Technique | "Search for technique..." |
| Place | "Search for place..." |
| Subject | "Search for subject..." |
| Classification | "Search for object type..." |
| Organization | "Search for organization..." |

---

## Section Headers

| Section | Header Text | Description |
|---------|-------------|-------------|
| Recent entries | "Recently Used" | Values this user has entered before |
| Organization values | "From Your Collection" | Values used by anyone in the organization |
| External sources | "Reference Sources" | Matches from Getty, Wikidata, etc. |

---

## Source Badges

Shown next to suggestions to indicate their origin:

| Source | Badge Text | When Shown |
|--------|------------|------------|
| Recent | *(no badge)* | Never - recent is the default |
| Organization | "Used in collection" | When value is used elsewhere in the org |
| Local vocabulary | "Local term" | Custom terms defined by the org |
| Getty ULAN | "Getty ULAN" | Artists from Getty vocabulary |
| Getty AAT | "Getty AAT" | Terms from Getty thesaurus |
| Getty TGN | "Getty TGN" | Places from Getty thesaurus |
| Wikidata | "Wikidata" | Matches from Wikidata |
| VIAF | "VIAF" | Names from Virtual International Authority File |
| Library of Congress | "Library of Congress" | LCNAF or LCSH matches |
| GeoNames | "GeoNames" | Geographic locations |
| ORCID | "ORCID" | Researcher identifiers |

---

## Status Indicators

### Verified Value

**Icon:** ✓ (checkmark, green)

**Tooltip:** "Verified in reference sources"

**Below-field text:** "Verified in reference sources"

**Purpose:** Indicates the value matches an entry in Getty, Wikidata, or similar databases. This helps with data quality but is not required.

---

### Unverified Value

**Icon:** *(none)*

**Tooltip:** *(none)*

**Below-field text:** *(none)*

**Purpose:** No indicator needed. Most values will be unverified, and that's completely fine. We don't want to make users feel bad about entering data.

---

### Loading

**Icon:** Spinning circle (replaces search icon)

**Text in dropdown:** "Searching reference sources..."

**Purpose:** Shows that we're looking for matches. Local suggestions appear immediately; this is for external searches.

---

### Offline

**Icon:** Cloud with slash (subtle, in input)

**Tooltip:** "Working offline — showing local suggestions only"

**Text in dropdown:** *(none - just shows local results)*

**Purpose:** Non-alarming indication that external search isn't available. The component still works fully.

---

### No Results

**Text:** "No matches found — you can still use your entry"

**Purpose:** Reassure users that no match is fine. They can enter anything.

---

## Action Items

### Use As Entered

**Text:** Use "[value]" as entered

**Icon:** + (plus)

**Example:** Use "J. Smith" as entered

**Purpose:** Always-available option to use exactly what was typed, without selecting from suggestions.

---

### Clear Field

**Icon:** × (x)

**Tooltip:** "Clear"

**Purpose:** Remove the current value.

---

## Help Text (Optional)

Can be shown below the field on first use or via help icon:

| Field Type | Help Text |
|------------|-----------|
| Creator | "Start typing an artist or maker's name. Matching entries from Getty and other reference sources will appear automatically." |
| Material | "Enter materials like 'oil paint' or 'bronze'. We'll suggest matching terms from standard vocabularies." |
| Place | "Search for locations by name. Results include matches from geographic databases." |
| General | "Type to search. You can select a suggested match or use your own text." |

---

## Error States

### Search Failed

**Icon:** Warning triangle (subtle)

**Text:** *(none visible)*

**Behavior:** Silently fall back to local suggestions. Users shouldn't be bothered with technical errors.

---

### Network Unavailable

**Icon:** Cloud with slash

**Tooltip:** "Working offline"

**Behavior:** Works normally with local suggestions. External suggestions unavailable.

---

## Accessibility Announcements

Screen reader announcements (via ARIA live regions):

| Event | Announcement |
|-------|--------------|
| Suggestions loaded | "{n} suggestions available" |
| No results | "No suggestions found. Press Enter to use your text." |
| Item highlighted | "{label}, {description}, from {source}. Press Enter to select." |
| Value selected | "{label} selected" |
| Value cleared | "Field cleared" |

---

## Do's and Don'ts

### Do

- ✅ Say "reference sources" not "authorities"
- ✅ Say "verified" not "linked" or "matched"
- ✅ Say "from Getty" not "from ULAN"
- ✅ Make unverified entries feel normal
- ✅ Show that manual entry is always an option

### Don't

- ❌ Don't use "URI", "URL", or "link" when referring to references
- ❌ Don't use "authority", "authority file", or "controlled vocabulary"
- ❌ Don't use "linked data", "LOD", or "semantic web"
- ❌ Don't show error messages for network issues
- ❌ Don't make users feel like they need to select a suggestion
- ❌ Don't require verification for any field

---

## Tone

**Helpful but not pushy.** The autocomplete enhances data quality but never gets in the way. If external search fails, we fail silently. If there are no matches, we reassure users that's fine. The goal is to make cataloging easier, not to enforce data standards.

**Technical accuracy without technical language.** We're connecting to serious reference databases, but users don't need to know the details. "Getty ULAN" is acceptable because it's a recognizable brand name, but "VIAF authority record" is too jargon-y.

**Positive framing.** "Verified in reference sources" (positive) rather than "No match found" (negative). When we must show no results, we immediately follow with reassurance.
