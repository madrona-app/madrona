# Accessibility Conformance Report: Public portal (Discover)

**DRAFT. Not a conformance claim.** Based on VPAT® 2.5 (WCAG edition), WCAG 2.2 Level A and AA.
Every "Conformance Level" below is **Not evaluated** until the manual test pass
(docs/accessibility/screen-reader-test-script.md) has been run with JAWS on Windows
(Edge, Chrome), VoiceOver on iOS (Safari), keyboard only, and at 200%/400% zoom.
Fill each level only from recorded results, and record failures as failures.

- **Product:** Madrona, public portal (Discover) and member collections
- **Version:** branch nfb-gaps, November 2026 (record the exact commit tested)
- **Report date:** (date of the manual evaluation)
- **Contact:** (accessibility contact)
- **Evaluation methods:** automated checks (eslint-plugin-jsx-a11y recommended rules as build errors;
  axe-core via vitest-axe on rendered screens); manual testing (pending: see the test script).

## Terms
Supports; Partially Supports; Does Not Support; Not Applicable; Not Evaluated (VPAT 2.5 definitions).

## Table 1: Success Criteria, Level A and AA

| Criteria | Level | Conformance Level | Remarks and Explanations |
|---|---|---|---|
| 1.1.1 Non-text Content | A | Not evaluated |  |
| 1.2.1 Audio-only and Video-only (Prerecorded) | A | Not evaluated |  |
| 1.2.2 Captions (Prerecorded) | A | Not evaluated | Video playback on the portal depends on caption files supplied with each media file |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | A | Not evaluated |  |
| 1.2.4 Captions (Live) | AA | Not evaluated |  |
| 1.2.5 Audio Description (Prerecorded) | AA | Not evaluated |  |
| 1.3.1 Info and Relationships | A | Not evaluated |  |
| 1.3.2 Meaningful Sequence | A | Not evaluated |  |
| 1.3.3 Sensory Characteristics | A | Not evaluated |  |
| 1.3.4 Orientation | AA | Not evaluated |  |
| 1.3.5 Identify Input Purpose | AA | Not evaluated |  |
| 1.4.1 Use of Color | A | Not evaluated |  |
| 1.4.2 Audio Control | A | Not evaluated |  |
| 1.4.3 Contrast (Minimum) | AA | Not evaluated |  |
| 1.4.4 Resize Text | AA | Not evaluated |  |
| 1.4.5 Images of Text | AA | Not evaluated |  |
| 1.4.10 Reflow | AA | Not evaluated |  |
| 1.4.11 Non-text Contrast | AA | Not evaluated |  |
| 1.4.12 Text Spacing | AA | Not evaluated |  |
| 1.4.13 Content on Hover or Focus | AA | Not evaluated |  |
| 2.1.1 Keyboard | A | Not evaluated |  |
| 2.1.2 No Keyboard Trap | A | Not evaluated |  |
| 2.1.4 Character Key Shortcuts | A | Not evaluated |  |
| 2.2.1 Timing Adjustable | A | Not evaluated |  |
| 2.2.2 Pause, Stop, Hide | A | Not evaluated |  |
| 2.3.1 Three Flashes or Below Threshold | A | Not evaluated |  |
| 2.4.1 Bypass Blocks | A | Not evaluated |  |
| 2.4.2 Page Titled | A | Not evaluated |  |
| 2.4.3 Focus Order | A | Not evaluated |  |
| 2.4.4 Link Purpose (In Context) | A | Not evaluated |  |
| 2.4.5 Multiple Ways | AA | Not evaluated | Search, facets, breadcrumbs and exhibitions; confirm in manual testing |
| 2.4.6 Headings and Labels | AA | Not evaluated |  |
| 2.4.7 Focus Visible | AA | Not evaluated |  |
| 2.4.11 Focus Not Obscured (Minimum) | AA | Not evaluated |  |
| 2.5.1 Pointer Gestures | A | Not evaluated |  |
| 2.5.2 Pointer Cancellation | A | Not evaluated |  |
| 2.5.3 Label in Name | A | Not evaluated |  |
| 2.5.4 Motion Actuation | A | Not evaluated |  |
| 2.5.7 Dragging Movements | AA | Not evaluated |  |
| 2.5.8 Target Size (Minimum) | AA | Not evaluated |  |
| 3.1.1 Language of Page | A | Not evaluated |  |
| 3.1.2 Language of Parts | AA | Not evaluated |  |
| 3.2.1 On Focus | A | Not evaluated |  |
| 3.2.2 On Input | A | Not evaluated |  |
| 3.2.3 Consistent Navigation | AA | Not evaluated |  |
| 3.2.4 Consistent Identification | AA | Not evaluated |  |
| 3.2.6 Consistent Help | A | Not evaluated |  |
| 3.3.1 Error Identification | A | Not evaluated |  |
| 3.3.2 Labels or Instructions | A | Not evaluated |  |
| 3.3.3 Error Suggestion | AA | Not evaluated |  |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | Not evaluated |  |
| 3.3.7 Redundant Entry | A | Not evaluated |  |
| 3.3.8 Accessible Authentication (Minimum) | AA | Not evaluated | Member sign-in uses an emailed one-time link (no password or cognitive test) |
| 4.1.2 Name, Role, Value | A | Not evaluated |  |
| 4.1.3 Status Messages | AA | Not evaluated |  |

Note: WCAG 2.2 removed 4.1.1 Parsing; it is not reported.

## Automated evidence at the time of drafting
- jsx-a11y: 0 errors across the frontend (rules enforced as errors). Exceptions are per line with a reason.
- axe-core: no violations on the screens covered by the a11y test files (see frontend/src/test/**/*.a11y.test.tsx
  and checkA11y calls in other tests). Screens without a rendered test are not covered by axe.

## Known issues found during remediation (to confirm or close in manual testing)
See the Remarks column. These are recorded so the evaluation starts from them, not as final results.

