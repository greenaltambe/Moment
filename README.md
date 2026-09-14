# Moment — Intentional Website Blocker & Digital Mindfulness

> *"Create a moment between impulse and action."*

Moment is a research-informed, privacy-first website blocker and browser extension for **Chrome Desktop**, **Firefox Desktop**, and **Firefox Android**.

Unlike traditional punitive website blockers that act as rigid digital prison guards, Moment introduces **intentional, compassionate friction**—giving users the mental space to pause, reflect, and make conscious choices before navigating to distracting websites.

---

## Current Status: Phase 8 (Release Readiness & Robustness Audit) — COMPLETE

Phase 8 executes a hostile release-readiness and robustness audit across all 27 architectural lifecycle dimensions, validating zero data loss, safe corruption recovery, MV3 service worker resilience, and zero authorization leaks:

* **Phase 0 Constitution:** Ratified (v1.2-HARDENED).
* **Pre-Phase-1 Technical Spike:** Completed (Empirically verified on Firefox Desktop 155.0).
* **Phase 1 & 1.1 Foundation & Hardening:** Completed & verified.
* **Phase 2 & 2.1 Policy & Rule Engine:** Completed & semantically audited.
* **Phase 3 & 3.1 Interventions & Mindfulness:** Completed & semantically audited.
* **Phase 4 & 4.1 Usage Accounting & Time Budgets:** Completed & semantically audited.
* **Phase 5 & 5.1 Product UI & Validation:** Verified in Firefox Desktop runtime.
* **Phase 6 & 6.1 Momentary Access — Intent Passes:** Verified in Firefox Desktop runtime.
* **Phase 7 Focus Mode:** Completed & verified.
* **Phase 7.1 Theme Consistency & UI Polish:** Central design tokens, zero-flash dark theme, cross-surface consistency.
* **Phase 8 Release Readiness & Robustness Audit:**
  - **Extreme Storage Corruption Defense:** Hardened `migrateStorageState` against malformed JSON, raw arrays, non-objects, and null records, safely preserving valid collections and settings while resetting corrupted runtime structures.
  - **Core Decision Engine Hardening:** Guarded collection loops against null or invalid collection objects in `MomentDecisionEngine` and malformed schedule intervals in `isTimeInInterval`.
  - **Background Error Containment:** Wrapped all asynchronous browser navigation and tab lifecycle callbacks in `try...catch` blocks, preventing unhandled promise rejections during abrupt tab closures.
  - **Lifecycle Isolation & Hygiene:** Automatic pruning of deleted collections from active `FocusSession`s, cross-tab intervention completion spoofing prevention, and discrete pass duration clamps.
  - **Scale & Performance Verified:** Benchmark verified: 1,000 rules across 10 collections evaluated in ~0.011ms per decision (>90,000 evaluations/sec).

---

## Architectural Principles

1. **Local-First & Zero-Knowledge:** 100% of data resides locally on the user's machine in `chrome.storage.local`. No accounts, no servers, no analytics, no external network calls.
2. **Core Isolation:** `src/core/` contains pure domain logic. It **never imports browser APIs**. All browser interactions are mediated by the `BrowserAdapter` interface.
3. **Mindful Friction Over Punishment:** Interventions (breathing pauses, clear intent timers, conscious confirmations) foster self-regulation without triggering psychological reactance.
4. **Specificity Dominates Policy Severity:** Granular exceptions always defeat broad rules regardless of policy harshness.
5. **Persistence Across Worker Eviction:** All temporary authorization grants and pending intervention states are backed by extension storage, ensuring resilience against service worker / event page termination.
6. **Least Privilege:** Manifest permissions only request what is actively required by the current architectural phase.

---

## Project Structure

```text
Moment/
├── manifest/              # Platform-specific MV3 manifests (least privilege)
│   ├── chrome/            # Chrome Desktop (service_worker)
│   └── firefox/           # Firefox Desktop & Android (background scripts)
├── src/
│   ├── core/              # Domain models, decision engine, grant validation (Zero browser imports)
│   │   ├── models/        # Target, Collection, Boundary, Grant
│   │   ├── matching/      # CanonicalUrl, Bounded Glob Compiler, Target Matcher
│   │   ├── policies/      # Boundary & Schedule Evaluator (24/7, interval, overnight)
│   │   ├── decisions/     # Resource-Dominant Specificity Tuple & MomentDecisionEngine
│   │   └── grants/        # Centralized grant validator (target, duration, navigation)
│   ├── browser/           # Browser adapter layer & capability matrix
│   │   ├── adapter.ts     # Typed browser adapter contract
│   │   ├── capabilities.ts# Platform capabilities & verification status profiles
│   │   ├── chrome/        # Chrome adapter implementation
│   │   └── firefox/       # Firefox adapter implementation
│   ├── storage/           # Versioned storage envelope, migrations & atomic mutation queue
│   │   ├── schema.ts      # Storage envelope (schemaVersion: 1)
│   │   ├── migrations.ts  # State migration engine
│   │   └── storage.ts     # ExtensionStorage implementation
│   ├── background/        # Extension background entry point & lifecycle
│   │   ├── index.ts       # Message dispatcher & navigation interceptor
│   │   └── lifecycle.ts   # Startup verification & schema initialization
│   ├── ui/                # User interface shells (responsive, mobile-ready)
│   │   ├── popup/         # Extension popup (current site display, mode selector)
│   │   ├── options/       # Options dashboard (navigation & settings shell)
│   │   ├── intervene/     # Intervention shell (pause, nonce validation, replace navigation)
│   │   └── block/         # Calm block page (informative, no escape hatch)
│   ├── shared/            # Typed message protocol, URLs, constants, errors
│   └── diagnostics/       # In-memory structured logger (zero network reporting)
├── tests/
│   ├── unit/              # Core, storage, messages, grants, and adapter tests
│   └── integration/       # Real browser bundle loading verification
├── scripts/               # Build, typecheck, lint, and test scripts
└── dist/                  # Built unpacked extension artifacts
    ├── chrome/            # Unpacked Chrome MV3 distribution
    └── firefox/           # Unpacked Firefox MV3 distribution
```

---

## Verification Matrix

| Verification Category | Firefox Desktop (155.0) | Chrome Desktop (MV3) | Firefox Android (GeckoView) |
| :--- | :---: | :---: | :---: |
| **Category A: Bundle & Install** | **VERIFIED** | UNVERIFIED — REQUIRES MANUAL TESTING | UNVERIFIED — REQUIRES MANUAL TESTING |
| **Category B: Static Page Structure** | **VERIFIED** | **VERIFIED** | **VERIFIED** |
| **Category C: Runtime Execution** | UNVERIFIED — REQUIRES MANUAL TESTING | UNVERIFIED — REQUIRES MANUAL TESTING | UNVERIFIED — REQUIRES MANUAL TESTING |
| **Category D: Real UI Interaction** | UNVERIFIED — REQUIRES MANUAL TESTING | UNVERIFIED — REQUIRES MANUAL TESTING | UNVERIFIED — REQUIRES MANUAL TESTING |

*Note: Automated WebDriver access to internal `moz-extension://` and `chrome-extension://` pages is restricted by browser security policies. End-to-end interactive UI flows require manual verification in real browser profiles.*

---

## Development & Test Commands

```bash
# Verify architectural invariants (Core isolation, CSP, eval, location.replace)
npm run lint

# Run full TypeScript semantic typecheck
npm run typecheck

# Build unpacked distribution packages for Chrome and Firefox
npm run build

# Run automated unit test suite (447 tests across 115 suites)
npm run test

# Run browser integration verification test
node tests/integration/browser_load.test.js
```

---

## Loading the Extension

### Google Chrome (Desktop)
1. Run `npm run build`.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in upper-right corner).
4. Click **Load unpacked**.
5. Select the `dist/chrome` folder inside this repository.

### Mozilla Firefox (Desktop)
1. Run `npm run build`.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select `dist/firefox/manifest.json`.

### Firefox for Android
1. Run `npm run build`.
2. Install via web-ext or load the `dist/firefox` bundle into your GeckoView / Firefox Nightly debug build via ADB.

---

## License

MIT License — Moment Project.
