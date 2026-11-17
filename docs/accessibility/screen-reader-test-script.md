# Screen reader test script: core workflows

A manual script for testing the staff interface and the public portal with
assistive technology. It complements the automated checks (axe-core in the
component tests, jsx-a11y lint rules); those cannot tell whether a task is
*efficient* for a blind user, and this script can.

## Configurations

Run every workflow in each of these, in this order:

| # | Screen reader | Platform | Browser |
|---|---|---|---|
| A | JAWS (current release) | Windows 11 | Edge |
| B | JAWS (current release) | Windows 11 | Chrome |
| C | VoiceOver | iOS (current) | Safari |
| D | Keyboard only, no screen reader | any | any |

Then, when time allows: NVDA + Firefox/Chrome, Narrator + Edge, VoiceOver on
macOS + Safari, 200% and 400% zoom (reflow at 320 CSS px), and Windows high
contrast / forced colours.

## How to record results

For each workflow and configuration, record:

- **Pass / Fail / Pass with difficulty.** "Pass with difficulty" means the
  task was completed but was slow or confusing. Treat it as a defect.
- **Time taken**, roughly.
- **What was announced** at each numbered check, when it differed from what
  is expected.
- **The WCAG 2.2 success criterion** a failure relates to (for example 1.3.1,
  2.1.1, 2.4.3, 2.4.7, 3.3.1, 4.1.2, 4.1.3), if you can tell.

Use the results table at the end. Results feed the Accessibility Conformance
Reports. Record only what was actually observed, failures included.

Start each workflow signed in as the role shown, at the Collections home
page, with the screen reader's default verbosity.

---

## Staff interface

### 1. Sign in and reach the main content
Role: any.
1. Open the sign-in page. Check: the page title and the "Email" and "Password" fields are announced with their labels.
2. Submit with the password empty. Check: the error is announced, and focus or the virtual cursor is placed on it.
3. Sign in. Check: the page title changes and is announced; a "Skip to main content" link is the first thing reached by Tab, and it moves focus into the main content.
4. Check: the headings list (JAWS Insert+F6; VoiceOver rotor, Headings) shows one level 1 heading naming the page.

### 2. Create an object record
Role: cataloguer.
1. Go to Objects and choose "New object". Check: the form fields have their labels announced, and required fields say "required".
2. Leave Object number empty and save. Check: the error is announced and is associated with the field (it is read when the field gets focus).
3. Enter a number and a title, and save. Check: the save is announced (status message) without moving you unexpectedly.

### 3. Catalogue with controlled terms
Role: cataloguer.
1. In the object record, open Subjects and add a subject. Check: the autocomplete announces itself as a combo box, says when suggestions are available and how many, and arrow keys move through options that are read aloud.
2. Search "braille" and choose a Library of Congress subject heading. Check: the chosen term and its source are announced, and the saved value shows on the record.
3. If strict vocabulary is switched on for the field, type a term that is not in the vocabulary. Check: you are told why it cannot be added.

### 4. Attach a file and write its alternative text
Role: cataloguer.
1. In the object's Media section, upload an image, a `.brf` braille file and a `.html` file. Check: the file chooser is labelled, and upload progress and completion are announced.
2. Open the image's media record and choose Edit. Check: Title, Description, Alt Text, Caption, Credit, Copyright Notice and Preferred Citation are each announced with their label.
3. Enter alternative text and a preferred citation, and save.
4. Open the `.html` attachment. Check: it downloads rather than opening as a web page.

### 5. Add an external link
Role: cataloguer.
1. In "Citations & References", in edit mode, choose "Add external link". Check: focus moves to "Link 1 web address" and "Link 1 added" is announced.
2. Enter `javascript:alert(1)`. Check: the field is announced as invalid with the reason.
3. Enter a Wikipedia address and a label, then leave edit mode. Check: the link is read as "<label>, opens in a new tab".
4. Remove the link. Check: the Remove button names the link it removes, focus returns to "Add external link", and the removal is announced.

### 6. Set record flags
Role: cataloguer.
1. In the "Record status" region, find Flags. Check: it is announced as a group named "Flags", and each flag is a checkbox with its name and description.
2. Tick "Heavy". Check: "Flags saved: Heavy" is announced.
3. Check: any flag set automatically by a completeness rule is read as text, not offered as a checkbox.

### 7. Submit a record for review (intern)
Role: intern.
1. In "Record status", find "Review: …". Choose "Submit for review" without choosing a reviewer. Check: the Reviewer field is announced as invalid with "Choose who should review this record", and has focus.
2. Choose a reviewer, add a note, and submit. Check: "Submitted for review. <name> has been notified." is announced, and focus moves to the heading "Review: In review".

### 8. Review a record (reviewer)
Role: archivist (the reviewer chosen in 7).
1. Open notifications. Check: there is a notification naming the record, and opening it reaches the record.
2. Also open Work → Approvals. Check: the record is listed as awaiting you.
3. On the record, choose "Request changes" and submit without notes. Check: the notes field is announced as invalid and has focus.
4. Enter notes and submit. Check: the outcome is announced; "Review history" lists the decision, who made it, when, and the notes.
5. As the intern, check that a notification reports the requested changes and that the decision form is not offered to the intern.

### 9. Completeness rules and publishing
Role: administrator, then archivist.
1. Collections settings → Flags & Completeness. Add a rule "Ready to publish" requiring Title, Brief description and Alternative text on every image, marked "Required before a record can be published". Check: each requirement row's controls are named "Requirement 1 field", "Requirement 1 check", and so on.
2. Choose "Re-check all records". Check: the number of records checked is announced.
3. On a record that does not meet the rule, find "Completeness rules". Check: the rule is read as "not met" with the list of what is missing.
4. Turn on "Published to public portal". Check: it is announced as a switch with its on/off state; the attempt fails and the reason is announced.
5. As a user without the publish permission, check that the publication state is read as text ("Public portal: Not published"), not as a control.

### 10. Record a location change
Role: registrar.
1. On an object, record a movement to a new location. Check: the location picker can be operated by keyboard, its options are read, and the result is announced.
2. Check: the new current location is read on the record.

### 11. Inventory: random spot-check list and bulk update
Role: registrar.
1. Open an audit campaign with a target location and the sampling method "Random", sample size 10. Choose "Generate check list". Check: the result count is announced and the table has a caption and column headers that are read with each cell (JAWS Ctrl+Alt+arrows; VoiceOver rotor, Tables).
2. Mark one row "Found", one "Not found" and one "Wrong location". Check: each button names its object, its pressed state is announced, and each change is announced.
3. Select the "Wrong location" rows and run "Update current location to the found location". Check: the selection count is announced; the preview and the result are announced.

### 12. Researcher visit log
Role: registrar.
1. Create a research visit with a researcher, a date and a purpose, and add two objects used. Check: fields are labelled, and adding and removing objects is announced, with focus placed sensibly.
2. On one of those objects, check that the visit is listed under research visits.

### 13. Find a record by faceted search
Role: any staff.
1. Search for a term and apply two facets. Check: the result count is announced after each change; facet checkboxes are labelled with their value and count.
2. Move from the result list to a record and back. Check: the search, facets and position are kept.

### 14. Export a report
Role: any staff.
1. Generate the Object Record Sheet for an object with an image and attachments. Check: "Export format" is a radio group, accessible formats come first, and each option is labelled.
2. Download "Accessible web page (HTML)" and open it. Check: one level 1 heading, sections as level 2, the image's alternative text is read (not "Primary image"), the attachments table has column headers, and "Attachments" lists the file names.
3. Download "Word document" and "Plain text" and open each with the screen reader. Check: Word headings appear in the headings list and table header rows repeat; the text file reads as labelled lines.

### 15. Import a spreadsheet through Bridge
Role: administrator.
1. Bridge → Connectors → "Upload a spreadsheet". Choose a `.xlsx` file. Check: the file input is labelled with the accepted types, and upload progress and the preview result are announced.
2. Check: the preview table has a caption and column headers; the sheet selector and header row field are labelled.
3. Map Object number and Title and create the source.

## Public portal

### 16. Search, breadcrumbs, permalink and export
Role: public visitor (signed out).
1. Search the portal and apply a facet. Check: the result count is announced; the breadcrumb is a navigation landmark named "Breadcrumb" with the current page marked.
2. Use "Copy link to these results", open the copied address in a new tab. Check: the same results and facets appear.
3. Open an object. Check: the breadcrumb leads back to the exact results; the metadata is read as label/value pairs; images have meaningful alternative text; the preferred citation and external links are read.
4. Download the results as CSV. Check: the control says how many results it downloads.

---

## Results

| Workflow | A JAWS+Edge | B JAWS+Chrome | C VoiceOver iOS | D Keyboard | Notes / criteria |
|---|---|---|---|---|---|
| 1 Sign in | | | | | |
| 2 Create object | | | | | |
| 3 Controlled terms | | | | | |
| 4 Attach file, alt text | | | | | |
| 5 External link | | | | | |
| 6 Record flags | | | | | |
| 7 Submit for review | | | | | |
| 8 Review a record | | | | | |
| 9 Completeness and publishing | | | | | |
| 10 Location change | | | | | |
| 11 Inventory spot check | | | | | |
| 12 Visit log | | | | | |
| 13 Faceted search | | | | | |
| 14 Export a report | | | | | |
| 15 Spreadsheet import | | | | | |
| 16 Public portal | | | | | |

Tester: ______  Date: ______  Screen reader versions: ______  Browser versions: ______
