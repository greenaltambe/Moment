# Changelog

All notable changes to **Moment** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added — Accent colors
- Settings → Accent Color: pick an accent separately for the light and the dark appearance from Moment Green, the 9 GNOME accents, or 4 Firefox accents. Colors are auto-adjusted for readable contrast; Calm Sepia keeps its own palette. Included in export/import.

### Fixed
- "Default unlock scope" in Settings was never saved (the background ignored it).

### Changed — Material 3 Expressive UI
- New shared `src/ui/expressive.css` layer (loaded after each page's CSS): large rounded shapes, pill buttons with springy press motion, tonal green-tinted surfaces (light and dark), bigger type, soft elevation, pill chips and progress bars.
- Mobile: floating bottom navigation bar and extended "New Collection" button on the dashboard, rule rows as tonal cards, bottom-sheet dialogs, 48px touch targets on touch devices, popup fills the width on Firefox Android.
- Intervention page: new layered breathing orb (halo rings grow with the breath, shape morphs on the hold, phase label in accent color), tonal intention banner, bigger action buttons, and a roomier layout (spacing rhythm, tonal "Need access" panel, larger timer). Limit page spacing aligned. The orb now grows ~1.9x on "Breathe in". The pause and limit cards fit the window height: scrolling body, fixed footer with Turn Back / Continue side by side.
- Custom M3 controls everywhere: animated radios, checkboxes and a switch (Reduce motion), tonal choice rows, filter-chip focus durations, rounded day/color chips, a styled select and disclosure drawer, tonal Edit/Delete actions, thin scrollbars.


### Changed
* **Daily limits now work as a time budget.** A collection with a daily limit is freely accessible until the limit is used up, then blocked until local midnight. Previously a limit changed nothing (the same pause appeared before and after). Collections without a limit keep their pause/block on every visit. Focus Mode remains stricter than the budget.
* When the budget runs out while a page is open, Moment now re-checks open tabs (via the usage checkpoint and a wake-up alarm) instead of waiting for the next navigation. A spent budget also overrides earlier passes and grants.
* Intent Passes are no longer available on Strict Block collections or once a daily budget is spent.
* New collections default to "Allow active page until next navigation" when temporary access expires (existing collections are unchanged).

### Added
* **Focus Mode is more meaningful:** starting it now applies immediately to pages already open and ends temporary passes on the focused collections. The collection picker lists only collections where Focus Mode changes something (those with a schedule or a daily limit) and explains why. Ending Focus early now takes a short wait (10 s) and a written reason.
* **Pre-expiry warning:** a toolbar badge shows "1m" for the last minute of a pass, and the remaining minutes during the last 5 minutes of a daily budget (best-effort; not shown where the browser has no toolbar badge, e.g. Firefox Android).
* **Pause is enforced by the background**, not only by the page's own timer: completing a Timer or Breathe pause too early is refused.
* **Intent Pass now needs a written reason** (at least 3 characters) and a few seconds on the pause page, as the changelog for 1.2.0 already promised.
* **Intention-gated extensions:** when the budget is spent, the block page offers up to 3 extensions per day of 5 minutes each, each requiring a short written intention (the text is not stored). Not offered on Strict Block collections.

### Fixed
* Hostnames with a trailing dot (`youtube.com.`) no longer bypass rules.
* Pass-expiration alarms are parsed correctly (the pass type contains an underscore).
* Removed a leftover test hook (`/moment-test-target`) from production navigation handling.

---

## [1.2.1] - 2026-09-14

### Added
* **Temporary Unlock Scope**: Added option to choose between *Current tab only* (least-privilege default) and *All tabs until expiration* when temporary access is granted.
* **Opening Pause Messages**: Optional pre-intervention behavioral reflections across four intensity tiers (*Mild*, *Sarcastic*, *Spicy*, and *Brutal*) to interrupt automatic browsing habits.
* **Expanded Icon Suite**: High-contrast, multi-resolution application icons (16px, 32px, 48px, 96px, 128px, 256px, 512px) compatible with desktop and mobile browser toolbars and Android home surfaces.
* **Mozilla Add-ons (AMO) Compliance**: Bundled root manifest compatibility and verified `data_collection_permissions: { required: ["none"] }` in Firefox Gecko metadata.

### Improved
* **UI & Accessibility Polish**: Material 3 Expressive-inspired touch targets (>= 44px on mobile, 48px for primary actions), comfortable spacing scale, and keyboard navigation focus rings.
* **About & Privacy Redesign**: Rewritten with calm, transparent, and factual technical disclosures explaining the local-first architecture.
* **Options Hierarchy & Spacing**: Polished layout and margins for Message Intensity selectors and contextual explanations.
* **Mobile Responsiveness**: Dynamic table-to-card layout transformation for rules management on screens <= 600px (Firefox Android).

### Fixed
* Fixed inline element margin issue on form helper hints where vertical margins were ignored by browser CSS engines.
* Fixed Firefox dark theme media query parser discard bug by separating at-rules from attribute selectors.
* Removed legacy development test message handlers and obsolete spike code.

---

## [1.2.0] - 2026-09-10

### Added
* **Intent Passes**: Option to mandate typing an intentionality note before receiving temporary access to restricted collections.
* **Cumulative Daily Limits**: Event-driven active browsing accounting with OS sleep clamping and midnight rollover support.
* **Focus Mode**: On-demand focus sessions with configurable durations and collection restrictions.
* **Storage Migrations Engine**: Envelope versioning (Schema v3) with safe recovery from malformed or corrupted JSON.
