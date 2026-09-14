# Changelog

All notable changes to **Moment** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
