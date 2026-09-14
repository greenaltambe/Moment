# Mozilla Add-ons (AMO) Listing & Submission Guide

This document contains the verified listing copy, technical descriptions, permissions rationales, and reviewer instructions required for submitting Moment to Mozilla Add-ons (AMO).

---

## Basic Information

* **Name**: Moment — Intentional Website Blocker
* **Add-on ID (`browser_specific_settings.gecko.id`)**: `moment@greenaltambe.github.io`
* **Slug**: `moment-intentional-blocker`
* **Summary (Short Description)** (max 250 characters):  
  Create a mindful pause between impulse and action. A research-informed, privacy-first website blocker and intentionality tool with zero tracking.
* **Categories**:
  * Primary: *Productivity*
  * Secondary: *Privacy & Security*
* **Tags**:
  `digital-wellbeing`, `website-blocker`, `mindfulness`, `productivity`, `focus`, `privacy`, `open-source`
* **License**: MIT License
* **Homepage / Source Repository**:  
  `https://github.com/greenaltambe/Moment`
* **Support / Bug Reports**:  
  `https://github.com/greenaltambe/Moment/issues`

---

## Detailed Description (AMO Listing Body)

```markdown
Moment helps you build a healthier, more intentional relationship with the internet by introducing compassionate friction before you visit distracting websites.

Unlike traditional site blockers that act like digital prison guards—locking you out and provoking frustration—Moment creates a mindful pause that interrupts automatic browsing loops and returns conscious choice to your attention.

### ✨ Key Features

* **Intentional Pauses**: Choose between guided Calm Breathing (10 seconds), a customizable Countdown Timer (5–60 seconds), or Conscious Confirmation.
* **Collections & Granular Rules**: Organize sites into collections (Social Media, News, Entertainment) with precise domain patterns and exception whitelisting.
* **Temporary Unlock Scope**: Choose whether a temporary access pass applies to the current tab only or across all tabs until expiration.
* **Intent Passes**: Require typing an intentionality note before receiving temporary access, keeping your browsing purposeful.
* **Daily Usage Limits**: Cap daily time spent on specific collections using efficient, event-driven accounting.
* **Schedules & Focus Mode**: Restrict sites during specific daily hours, overnight intervals, or launch on-demand Focus Mode sessions.
* **Strict Blocking**: Completely lock out distracting domains during scheduled periods without pause or pass escape hatches.
* **Opening Pause Messages**: Optional sharp, behavioral roasts (from Mild to Brutal) that punctuate routine excuses before interventions begin.
* **Beautiful Adaptive UI**: Clean Material 3-inspired design with Dark, Light, Sepia, and System themes, fully responsive on desktop and Firefox Android.

### 🔒 Private by Design

* **Zero Telemetry & Tracking**: No analytics, tracking pixels, or remote telemetry pings.
* **100% Local Storage**: All rules, collections, usage durations, and settings remain exclusively on your device.
* **No Accounts or Cloud Dependency**: Moment functions completely offline without an account, login, or internet connectivity.
* **Strict CSP**: Prohibits inline scripts, remote styles, external fonts, and dynamic code evaluation.
```

---

## Permissions Justification (For Reviewers & Users)

| Permission | Justification |
| :--- | :--- |
| `storage` | Required to save collections, blocking rules, user preferences, and daily usage statistics locally on the user's device. |
| `tabs` | Required to detect the active tab's URL to evaluate site restrictions and track active browsing time. |
| `webNavigation` | Required to intercept top-level document navigations before restricted pages load and redirect them to the calm intervention page. |
| `alarms` | Required to reliably schedule temporary pass expiration timers and usage counter checkpoint flushes across service worker / event page lifecycles. |

*Moment requests zero host permissions (`<all_urls>`), zero cookie access, zero browsing history access, and zero webRequest blocking permissions.*

---

## Source Code & AMO Reviewer Information

When uploading `dist/addon.zip` to AMO, answer **Yes** to:
> *"Does your extension contain code that is transpiled, minified, or packaged using automated build tools?"*

Upload `dist/source.zip` (or `src.zip`) as the source package.

### Reviewer Build Instructions to Include in the Submission Form:

```text
To build the extension from the provided source archive:

1. System Requirements:
   - Node.js >= 18.0.0
   - npm >= 9.0.0
   - Zip utility (standard on Linux/macOS)

2. Extract source archive and install dependencies:
   npm install

3. Run quality verification (optional but recommended):
   npm run lint
   npm run typecheck
   npm test

4. Build the extension bundle:
   npm run build

5. Package the distribution zip:
   npm run pack:firefox

The reproducible unpacked add-on files will be located in 'dist/firefox/', and the packaged add-on will be located at 'dist/addon.zip'.
```
