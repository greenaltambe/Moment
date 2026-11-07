# Moment

> *A small pause between impulse and action.*

**Moment** is a research-informed, privacy-first website blocker and digital intentionality browser extension available for **Firefox Desktop**, **Chrome Desktop**, and **Firefox Android**.

Unlike traditional punitive site blockers that act like digital prison guards—often prompting frustration, reactance, and immediate uninstalls—Moment introduces **compassionate, intentional friction**. By interrupting automatic browsing loops with mindful pauses, Moment returns conscious agency to your attention.

---

## Key Features

* **Collections & Granular Rules**: Group distraction-prone websites into named collections (e.g., *Social Media*, *News*, *Entertainment*) with precise URL patterns, domain-level rules, or wildcards.
* **Exceptions Support**: Whitelist productive subdomains, research paths, or internal work tools within otherwise restricted domains.
* **Mindful Interventions**: Choose your preferred pause experience before access is granted:
  * **Calm Breathing**: A 10-second guided mindful breath.
  * **Countdown Timer**: A customizable timer (5–60 seconds) that allows impulse to subside.
  * **Conscious Confirmation**: An immediate choice to proceed or turn back.
* **Temporary Unlock Scope**: Configure whether an intervention pass unlocks only the **current tab** or **all tabs** until expiration.
* **Intent Passes**: Require typing an explicit intention note before momentary access is granted, keeping you grounded in why you visited.
* **Daily Time Budgets**: Give a collection a daily limit and it stays open until the time is used up, then blocks until midnight. If you truly need more, up to 3 short extensions a day each need a written intention. Time is counted from discrete, event-driven checkpoints.
* **Scheduled Boundaries**: Restrict sites 24/7, during specific daily hours, or across overnight intervals.
* **Focus Mode**: Activate high-friction distraction-free sessions on demand.
* **Strict Blocking Option**: Block access unconditionally without pause or pass options for periods requiring absolute focus.
* **Opening Pause Messages**: Optional sharp, behavioral roasts (from *Mild* to *Brutal*) that puncture procrastination loops before the intervention begins.
* **Private & Local-First**: Zero telemetry, zero analytics, zero external network requests. All data stays exclusively on your machine.
* **Adaptive Theme System**: Clean Material 3-inspired design supporting *System*, *Light*, *Dark*, and *Sepia* themes with generous touch targets optimized for both desktop and mobile screens.
* **Data Portability**: Full JSON backup, restore, and validation engine.

---

## Project Architecture

Moment follows a strict layered architecture emphasizing **pure core domain logic** and **least-privilege browser adapters**:

```text
┌─────────────────────────────────────────────────────────────┐
│                       User Interface                        │
│            (Popup, Options, Intervene, Block)               │
└──────────────────────────────┬──────────────────────────────┘
                               │ Typed Protocol Messages
┌──────────────────────────────▼──────────────────────────────┐
│                  Background / Service Worker                │
│         (Navigation Interception, Timers, Lifecycle)        │
├──────────────────────────────┬──────────────────────────────┤
│     Browser Adapter Layer    │    Storage Envelope & Queue  │
│  (Chrome MV3 / Firefox MV3)  │      (chrome.storage.local)  │
└──────────────────────────────┼──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                      Core Policy Engine                     │
│         (Pure TypeScript — Zero Browser Dependencies)       │
│  - Decision Engine          - Target Matcher & Glob Parser  │
│  - Schedule & Limits Engine - Grant & Pass Validators       │
└─────────────────────────────────────────────────────────────┘
```

* **Core Isolation (`src/core/`)**: Pure domain models and algorithms. Does not import browser APIs or global objects, allowing exhaustive unit testing in vanilla Node.js.
* **Browser Adapters (`src/browser/`)**: Encapsulates browser differences (Chrome background service workers vs. Firefox background scripts, storage backends, and permission models).
* **Typed Message Bus (`src/shared/messages.ts`)**: Strict runtime validation of all communication between UI surfaces and the background process.

---

## Installation & Development

### Prerequisites

* [Node.js](https://nodejs.org/) (version 18.0.0 or higher)
* [npm](https://www.npmjs.com/)

### Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/greenaltambe/Moment.git
   cd Moment
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify the codebase**:
   ```bash
   npm run lint        # Verify strict CSP, core isolation, and security invariants
   npm run typecheck   # Typecheck entire TypeScript codebase
   npm test            # Run unit and integration test suites
   ```

4. **Build the extension**:
   ```bash
   npm run build
   ```

This generates unpacked extension distribution bundles:
* `dist/firefox/` — Firefox MV3 bundle (Desktop and Android)
* `dist/chrome/` — Chrome MV3 bundle (Service Worker)

---

## Loading Moment in Browsers

### Firefox Desktop
1. Open Firefox and navigate to `about:debugging`.
2. Click **This Firefox** in the sidebar.
3. Click **Load Temporary Add-on...**.
4. Select `dist/firefox/manifest.json`.

### Chrome / Chromium Desktop
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the upper-right corner.
3. Click **Load unpacked**.
4. Select the `dist/chrome` folder.

### Firefox Android
1. Connect your Android device with USB debugging enabled.
2. Build the Firefox bundle (`npm run build`).
3. Deploy to Firefox Nightly on Android using `web-ext run --target=firefox-android`.

---

## Available Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run build` | Transpiles TypeScript and builds distributions for Chrome and Firefox in `dist/`. |
| `npm test` | Runs the full automated test suite (550+ unit and integration tests). |
| `npm run typecheck` | Validates TypeScript types across source files and tests without emitting code. |
| `npm run lint` | Runs architectural linter checking Core isolation, CSP, and security invariants. |
| `npm run pack` | Builds and creates signed-ready release packages (`dist/addon.zip` and `src.zip`). |

---

## Privacy Architecture

Moment is built on a **zero-telemetry, local-first** foundation:

* **Zero Remote Analytics**: Moment does not contain analytics SDKs, telemetry beacons, tracking pixels, or remote error trackers.
* **No Account Required**: Moment works entirely offline and will never require login, registration, or cloud connectivity.
* **Local Storage Only**: All rules, collections, daily usage aggregations, and settings remain exclusively on your device in `chrome.storage.local`.
* **Zero Browsing History Retention**: Moment does not record visited URLs or maintain a history log. Only aggregated daily active browsing durations per collection are saved (`${dateKey}:${collectionId}`).
* **Strict CSP**: Extension pages enforce a strict Content Security Policy (`default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none';`) prohibiting inline scripts, inline style attributes, external fonts, and remote code execution.

For detailed privacy disclosures, see [PRIVACY.md](PRIVACY.md).

---

## Permissions Rationale

Moment adheres strictly to the principle of least privilege:

| Permission | Purpose & Technical Justification |
| :--- | :--- |
| `storage` | Required to store rules, collections, user preferences, and daily usage counters locally. |
| `tabs` | Required to detect the active tab's URL to evaluate site restrictions and track active browsing time. |
| `webNavigation` | Required to intercept top-level document navigations before page load and redirect restricted sites to the calm intervention page. |
| `alarms` | Required to reliably schedule pass expirations and periodic usage counter flush intervals within the ephemeral MV3 service worker lifecycle. |

*Moment does **not** request host permissions (`<all_urls>`), cookie permissions, browsing history permissions, or webRequest blocking permissions.*

---

## Known Limitations

* **Top-Level Navigation Enforcement**: Moment intercepts top-level browser navigations. Sub-resources (e.g., embedded iframes, external API calls, or background media streams) are intentionally not blocked.
* **Private / Incognito Browsing**: Browser security models disable extensions in private windows by default. Moment only runs in private windows if you explicitly grant permission in browser extension settings.
* **Firefox Android API Differences**: Window focus APIs (`browser.windows.onFocusChanged`) are unsupported on mobile operating systems. Moment transparently falls back to tab activation state on mobile platforms.

---

## Contributing

We welcome contributions! Please review [CONTRIBUTING.md](CONTRIBUTING.md) for development workflows, testing guidelines, and pull request conventions.

For security concerns, please see [SECURITY.md](SECURITY.md).

---

## License

Moment is open-source software licensed under the [MIT License](LICENSE).
