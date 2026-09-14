# Moment Architectural Blueprint

This document details the layered architecture of Moment and explains the rationales behind system boundaries.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                UI LAYER                                │
│   (Popup, Options Dashboard, Intervention Shell, Calm Block Page)      │
│   • Communicates with Background strictly via Typed Message Protocol   │
│   • HTML pages declare strict CSP (zero inline scripts, zero eval)     │
│   • Responsive baseline (360px viewport min, 48px touch targets)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │  Typed Messages
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              MOMENT CORE                               │
│              (Pure TypeScript / Zero Browser Dependencies)             │
│                                                                        │
│   • Domain Entities (Target, Collection, Boundary, Grant)              │
│   • Decision Engine Interface (evaluate(request) -> Decision)          │
│   • Precedence & Specificity Rules (Resource-Dominant Tuple)           │
│   • Time & Session Semantics (Active Tab Time calculation)             │
│                                                                        │
│   * Invariant: Never imports chrome.*, browser.*, or adapter code.     │
│   * 100% unit-testable in pure Node.js environments.                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         BROWSER ADAPTER LAYER                          │
│                                                                        │
│   • BrowserAdapter Interface (Tabs, Navigation, Storage, Windows)      │
│   • BrowserCapabilities Matrix (Explicit capability detection)         │
│   • ChromeAdapter (Desktop MV3 service worker)                         │
│   • FirefoxAdapter (Desktop & Android MV3 event page)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          BROWSER PLATFORM APIS                         │
│                                                                        │
│   • chrome.tabs / chrome.windows                                       │
│   • chrome.webNavigation.onBeforeNavigate                              │
│   • chrome.storage.local                                               │
│   • chrome.alarms                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Architectural Boundaries

### 1. Separation of Policy Semantics from Browser Enforcement
* **The Core** answers: *"What SHOULD happen to this navigation according to policy?"*  
  It evaluates rules, checks boundaries, and outputs an immutable, explainable Decision: `ALLOW`, `INTERVENE`, or `BLOCK`.
* **The Browser Adapter** answers: *"How can this browser make that happen?"*  
  It translates the decision into concrete platform actions (e.g. `tabs.update` to `intervene.html` or DNR rules).

### 2. Service Worker Ephemerality & Storage Persistence
In Manifest V3, background service workers terminate after 30 seconds of idle time.
* **The Trap:** Holding temporary grants or pending nonces in JavaScript memory (`Map`, `Set`) causes them to be wiped out when the worker suspends while a user is on `intervene.html`.
* **The Invariant:** All temporary access grants and pending intervention states are committed transactionally to `ExtensionStorage` (`storage.local`). When a worker wakes on a completion message, state is restored seamlessly.

### 3. Navigation History Integrity
* **The Back-Button Loop:** If an intervention navigates to destination via standard `window.location.href`, clicking the browser's "Back" button returns to `intervene.html`. If the authorization grant has expired, the user is trapped in an infinite loop.
* **The Invariant:** `intervene.ts` **exclusively uses `window.location.replace(targetUrl)`**. This replaces the intervention page in the tab's history, guaranteeing clean back-navigation.

### 4. Browser Capability Abstraction
Rather than branching code with `if (isChrome)` or `if (isFirefox)`:
* The system queries explicit capability flags on `BrowserCapabilities`:
  * `supportsWindowFocus`: Disabled on Android, enabled on desktop.
  * `supportsPopup`: Disabled on Android, enabled on desktop.
  * `supportsSessionRules`: Handled according to platform DNR support.

---

## Phase 2: Core Policy & URL Rule Engine Architecture

Phase 2 replaces placeholder logic with an authoritative, deterministic, pure domain policy evaluation engine.

### 1. Canonical URL Model (`src/core/matching/url.ts`)
* **Strict WHATWG URL parsing:** Wraps WHATWG `URL` parser without throwing exceptions on malformed input (returns `null` safely).
* **Protocol Isolation:** Strict distinction between `http:` and `https:`. No conflation. Non-web protocols (`javascript:`, `data:`, `file:`, `chrome:`, `moz-extension:`) are rejected.
* **Port Normalization:** Default ports (`80` for HTTP, `443` for HTTPS) normalized to empty string; explicit non-default ports preserved.
* **Hostname & Path Normalization:** Lowercases hostnames while strictly preserving subdomains, `www.`, and `m.`. Collapses relative traversal segments (`/a/b/../c` -> `/a/c`). Strips hashes.

### 2. Bounded Glob Grammar (`src/core/matching/glob.ts`)
* **Syntactic Bounds:** Max 256 characters length; max 2 path wildcards; leading host wildcard only (`*.example.com`); no wildcards in query strings.
* **Escaped Wildcard Support:** `\*` matches literal `*` safely.
* **Safety & Complexity:** Patterns are strictly bounded ($\le 256$ characters, $\le 2$ wildcards), mathematically preventing exponential $O(2^N)$ catastrophic backtracking. Theoretical worst-case execution across adversarial pathological input with 2 wildcards is bounded polynomial $O(N^2)$ (where $N$ is input URL path length). Practical execution on real-world browser URL lengths ($< 2048$ chars) is negligible and completes synchronously.

### 3. Resource-Dominant Lexicographic Specificity Tuple (`src/core/decisions/specificity.ts`)
When resolving conflicting rules, the engine computes a 7-element lexicographic tuple:
$$\text{Tuple}(R) = (K, P_{\text{segments}}, P_{\text{length}}, Q, H_{\text{type}}, H_{\text{depth}}, \text{priority})$$

1. **Kind ($K$):** `3` (Exact Page), `2` (Path Prefix or Glob with path wildcard), `1` (Website / Exact Host / Host-only Glob).
2. **Path Segments ($P_{\text{segments}}$):** Non-empty path segments (excluding trailing wildcards).
3. **Path Length ($P_{\text{length}}$):** Character length of path pattern (excluding trailing wildcards).
4. **Query Precision ($Q$):** `1` if query parameters specified; `0` otherwise.
5. **Host Type ($H_{\text{type}}$):** `2` if exact host / apex / pinned host; `1` if domain including subdomains (`*.domain.com` or `WEBSITE`).
6. **Host Depth ($H_{\text{depth}}$):** Segment count of hostname (e.g., `a.b.example.com` = 4, `example.com` = 2).
7. **User Priority:** Explicit user-assigned priority $[-100, +100]$ (default `0`).

#### Precedence Resolution Rules:
1. Higher tuple wins lexicographically.
2. If specificity tuples tie between an **Exception** and a **Restriction**, the **Exception wins** (`ALLOW`).
3. If tuples tie between two restrictions, higher policy severity wins (`BLOCK` > `INTERVENE`).
4. If identical in specificity and severity, the newest rule wins (`createdAt` timestamp).
5. Target path trailing slashes normalize identically (`/a/` and `/a` tie on specificity).

### 4. Boundary & Schedule Engine (`src/core/policies/boundary-evaluator.ts`)
* **Timezone Source:** Evaluates strictly in the device/browser's **local timezone** via JavaScript `Date` methods (`getDay()`, `getHours()`, `getMinutes()`), matching the local-first, zero-knowledge architectural invariant.
* **24/7 Mode:** When `schedule.enabled === false`, boundaries are active 24/7.
* **Interval Semantics:** Inclusive start minute, exclusive end minute (`[startMinute, endMinute)`).
* **Overnight Spans:** Intervals crossing midnight (e.g. `22:00 -> 07:00`) correctly evaluate whether the current minute $\ge 1320$ or $< 420$.
* **Fail-Closed:** Malformed or empty intervals default safely to inactive without throwing.

### 5. Deterministic Policy Pipeline (`src/core/decisions/engine.ts`)
Policy decision evaluation strictly executes in 6 deterministic stages:
1. **Grant Check:** If an unexpired, tab-isolated temporary access grant exists for the target origin, immediately return `ALLOW` (`ACTIVE_GRANT`).
2. **Rule Matching:** Run `matchTarget` across all targets in all collections. If zero matches, return `ALLOW` (`NO_RULE_MATCH`).
3. **Schedule & Boundary Evaluation:** For each candidate, evaluate `isBoundaryActive`. Inactive boundary matches are eliminated from restrictive action.
4. **Precedence Sorting:** Sort matching candidates using the Resource-Dominant Specificity Tuple and deterministic tie-breakers.
5. **Winning Candidate Evaluation:**
   - If winner is an **Exception**, return `ALLOW` (`EXCEPTION_RULE`).
   - If winner's collection boundary is inactive, return `ALLOW` (`SCHEDULE_INACTIVE`).
   - If winner's collection boundary pause action is `NONE` or `BLOCK_PAGE`, return `BLOCK` (`SCHEDULE_ACTIVE`).
   - If winner requires pause, return `INTERVENE` (`INTERVENTION_REQUIRED`).
6. **Decision Trace Generation:** Returns full immutable trace including `finalAction`, `reason`, candidate count, winning target ID, tuple, and collection ID for complete auditability.
* **Fail-Safe Fallback:** Malformed URLs, unparseable web schemes, or corrupted targets fail open to `ALLOW / NO_RULE_MATCH`. Malformed configurations do not crash the browser and do not create accidental blocks.

---

## Phase 3: Interventions & Behavioral Mindfulness Architecture

Phase 3 transforms the deterministic Phase 2 policy decisions (`INTERVENE` and `BLOCK`) into a calm, resilient, and accessible moment of mindful friction:

```
DECISION  ──►  INTERVENTION  ──►  INTENT  ──►  TEMPORARY ACCESS  ──►  DESTINATION
(Policy)       (State Machine)   (Reflection)   (Single-use Grant)     (replace())
```

### 1. Intervention State Machine (`src/core/interventions/state-machine.ts`)
The intervention process is modeled as an explicit, unidirectional state machine:

```
  NONE ──► PENDING ──► PRESENTED ──► IN_PROGRESS ──► COMPLETED ──► GRANT_ISSUED ──► NAVIGATING ──► DESTINATION
              │            │             │
              ├───► CANCELLED            │
              │                          │
              └───► EXPIRED / DISCARDED ─┘
```

* **States:**
  - `NONE`: No active intervention for tab.
  - `PENDING`: Navigation intercepted by background, `PendingIntervention` record created, tab directed to `intervene.html`.
  - `PRESENTED`: `intervene.html` loaded, sent `GET_INTERVENTION`, verified nonce, and presented UI to user.
  - `IN_PROGRESS`: User actively engaging in intervention (timer ticking down, breathing exercise running).
  - `COMPLETED`: Exercise finished or confirmation clicked (with valid intention text if required).
  - `GRANT_ISSUED`: Background verified completion and transition validity, persisted `TemporaryAccessGrant`, and removed pending nonce.
  - `NAVIGATING`: UI received grant response and triggered `window.location.replace(targetUrl)`.
  - `DESTINATION`: Target page loading under protection of active temporary access grant.
  - `CANCELLED`: User clicked "Close Tab" or "Never Mind" (`tabs.remove` or history back).
  - `EXPIRED`: Pending intervention age exceeded 15 minutes (`MAX_PENDING_INTERVENTION_LIFETIME_MS`).
  - `DISCARDED`: Tab closed or navigated away before completion.

* **Purity & Core Isolation:** State transitions and expiration checks are pure functions (`canTransition`, `transitionIntervention`, `isInterventionExpired`) in `src/core/interventions/` with zero browser imports.

### 2. Ratified Intervention Types
Moment implements the 3 human-approved intervention models without gamification or punishment:

1. **Conscious Confirmation (`CONFIRM`):**
   - Instant, lightweight pause for low-friction intentionality.
   - Displays destination domain cleanly stripped of auth/query credentials.
   - Requires deliberate click of primary action button.

2. **Intent Timer (`TIMER`):**
   - 5 to 60 second countdown with calm circular SVG progress meter.
   - Accessible countdown text with `aria-live="polite"`.
   - Action button remains disabled during countdown. **Never auto-navigates** when timer hits 0: requires user to consciously click "Proceed to Site" when ready.

3. **Calm Breathing (`BREATHE`):**
   - 4-phase breathing cadence (Inhale 4s, Hold 4s, Exhale 4s, Hold 4s) across 1 to 4 cycles.
   - Dynamic SVG breathing circle with high-contrast text and phase instruction prompts.
   - **Motion Accessibility:** Automatically detects `prefers-reduced-motion: reduce`. Disables circle animation and displays a calm static breathing prompt with step-by-step guidance.

### 3. Intention Text Requirement
When a collection enables `requireIntentionText`:
- The intervention presents an accessible `<input type="text">` or textarea prompting: *"What do you plan to do here?"*
- The proceed button remains disabled until non-whitespace text is entered.
- Background strictly verifies `intentionText` presence before issuing a grant.

### 4. Temporary Access Grant & Intent Pass Lifecycle
- **Background Authorization Authority:** UI code can never create or issue grants. All grants are constructed and authorized exclusively by the background runtime.
- **Duration Clamping:** Grant duration requested by UI is strictly clamped to `MAX_GRANT_DURATION_MS = 10 minutes` ($600\,000\text{ms}$) via `resolveGrantDuration`.
- **Single-Use Consumption:** When an authorized navigation occurs, the single-use grant is consumed immediately from extension storage. Subsequent navigations to the restricted site or page reloads ($F5$) encounter fresh policy evaluation.
- **Redirect & Scope Security:** A grant authorizes navigations exclusively within its targeted origin and path boundary. A redirect to an unrelated origin returns to ordinary policy evaluation. A grant never confers tab-wide "allow all" permissions.
- **Strict Tab Isolation:** Grants are strictly pinned to `tabId` and origin. A grant issued in Tab 1 cannot authorize navigation in Tab 2.
- **Replay Protection:** Completing an intervention atomically deletes the `PendingIntervention` record. Re-submitting the same nonce immediately rejects with an authorization error.
- **Pure Decision Consumption:** The intervention layer consumes the Phase 2 decision (`ALLOW`, `BLOCK`, `INTERVENE`) directly without reinterpreting exception rules. If the Phase 2 engine produced `ALLOW` because an exception won according to the ratified Resource-Dominant Specificity Tuple, navigation proceeds and no intervention occurs. If a restriction wins, it is respected.

### 5. History Loop Prevention
Navigation from `intervene.html` to target destination exclusively executes via:
```typescript
window.location.replace(targetUrl);
```
This replaces the intervention URL entry in the tab's session history. Pressing the browser's "Back" button returns to the page visited before the restricted site, avoiding infinite back-button traps.

### 6. Calm Block Page (`src/ui/block/`)
When policy evaluates to `BLOCK`:
- Displays informative, calm messaging explaining why the site is restricted.
- Shows sanitized destination domain without credentials or path clutter.
- **Zero bypass capability:** Provides only a "Close Tab" button. No temporary grants or pass-through buttons exist on the block page.

### 7. Inclusive Accessibility & Mobile Readiness
- **WCAG AA Compliance:** High contrast text ($\ge 4.5:1$), visible focus rings on interactive elements.
- **ARIA Semantics:** Live status announcements for countdowns and breathing transitions via `aria-live="polite"`.
- **Mobile Viewport:** Flexible CSS layout supporting viewports down to 360px with minimum 48px touch targets for mobile touch ergonomics (Firefox Android).
- **Prefers Reduced Motion:** Completely suppresses pulsing animations for users with vestibular or motion sensitivity.

---

## Phase 4: Usage Limits, Cumulative Time Budgets & Active Tab Tracking Architecture

Phase 4 implements active browsing accounting, cumulative time budgets, and daily limit enforcement without continuous 1-second timer loops:

### 1. Definition of Active Browsing Time
Time accumulates toward a collection's daily time budget **only** when all of the following conditions are simultaneously met:
1. The tab is the **active tab** in its browser window.
2. The browser window containing the tab is **focused** (`isWindowFocused === true`, or on Android platforms without window focus support, always assumed focused).
3. The tab has an **eligible web URL** (`http:` or `https:`) matching an active collection restriction.
4. The winning rule is a **restriction, not an exception**.

Internal extension pages (`chrome-extension://`, `moz-extension://`), system pages (`about:`, `chrome://`), non-web protocols, and inactive background tabs **never** accumulate browsing time.

### 2. Single Active Tab Accounting
Only **one tab across the entire browser** can accumulate active browsing time at any point in time. Multi-window focus switches, tab activations, and tab closures immediately flush elapsed active time and update the active tracking state.

### 3. Discontinuity & Sleep Clamping
To prevent machine sleep or OS hibernation from erroneously counting as active browsing, discrete intervals are clamped:
$$\Delta t = \min(\text{now} - \text{lastCheckpointTimestamp}, 60\,000\text{ms})$$
If system clock adjustments produce a negative delta ($\text{now} < \text{lastCheckpointTimestamp}$), delta is safely clamped to $0$ and the checkpoint timestamp is updated without corrupting stored usage.

### 4. Local Midnight Boundary Splitting
Active intervals that span local calendar midnight ($00:00:00$) are sliced at the boundary via `splitIntervalAtMidnight()`: pre-midnight milliseconds are attributed to yesterday's date key, and post-midnight milliseconds are attributed to today's date key, ensuring daily budgets reset cleanly at midnight in the device's local timezone.

### 5. Policy Engine Decision Integration & Intent Pass Co-existence
- When a collection's cumulative usage meets or exceeds its daily limit, `MomentDecisionEngine` outputs `DAILY_LIMIT_EXHAUSTED`.
- If the collection boundary is configured with Pause / Intervention (`BREATHE`, `TIMER`, `CONFIRM`), the engine returns `action: 'INTERVENE'`.
- If configured for Terminal Block without Pause (`pause.type === 'NONE'`), the engine returns `action: 'BLOCK'`.
- **Intent Pass Co-existence Invariant:** If an active unexpired Temporary Access Grant exists, the engine outputs `ALLOW` with `ACTIVE_GRANT`. An ongoing Intent Pass is permitted to complete its session even when the daily budget is exhausted, while usage continues to accumulate in the background. Subsequent navigations encounter the limit.

### 6. Storage Envelope (Schema Version 3)
The envelope version is upgraded to `schemaVersion: 3`, introducing `usage: Record<string, DailyUsageRecord>` where keys follow `${dateKey}:${collectionId}`. Migrations from `v1` and `v2` are automatic, deterministic, and safe.

---

## Phase 5: Product UI (Rules, Collections, Boundaries & Settings) Architecture

Phase 5 builds the human-facing interface for Moment, connecting the pure domain engine with browser extension pages via the typed message protocol.

### 1. Separation of Concerns & Security Boundaries
* **Pure Domain Validation (`src/core/validation/rules.ts`):** All pattern normalization, schedule formatting, and import validation reside in the pure domain core without browser dependencies.
* **Background Authority:** The UI never mutates `chrome.storage` directly. All mutations (collection CRUD, rule CRUD, settings updates) pass through typed message requests validated by the background dispatcher.
* **Strict CSP & Inline Script Prohibition:** UI pages (`popup.html`, `options.html`, `intervene.html`, `block.html`) adhere to strict MV3 CSP (`script-src 'self'`). Zero inline scripts or event handlers (`onclick`) are used.

### 2. UI Shells
* **Popup (`src/ui/popup/`):** Lightweight, responsive popup displaying current site status, active collection/rule, time spent vs. daily limit, quick actions (`Edit in Dashboard`, `Remove Rule`), and an accessible quick-add progressive disclosure drawer.
* **Options Dashboard (`src/ui/options/`):** 4-section dashboard:
  - *Collections & Rules:* Overview cards, target rule tables, exception badges, and rule/collection modals.
  - *General Settings:* Theme switcher (`system`, `light`, `dark`, `sepia`), time format (`12h`, `24h`), and reduced motion preference.
  - *Import & Export:* Versioned JSON backup export and validated import (`merge` and `replace` modes).
  - *About & Privacy:* Local-first, zero-telemetry architecture statement and diagnostic info.

---

## Phase 5.1: Validation & UX Audit Hardening

Phase 5.1 audits the frozen Phase 5 implementation, hardening validation, security, concurrency, and accessibility:

### 1. WEBSITE Normalization & Port Bounds (`src/core/validation/rules.ts`)
* **Port Support & Boundary Validation:** Accepts explicit numeric ports (e.g. `localhost:3000`, `example.com:8080`), strictly validating range $1 \le \text{port} \le 65535$. Rejects invalid non-numeric or out-of-range ports (`example.com:abc`, `example.com:99999`, `example.com:0`).
* **Trailing Slash Normalization:** Uses `.replace(/\/+$/, '')` to safely collapse multiple trailing slashes (`https://example.com///` $\to$ `example.com`).
* **Subdomain Specificity Preservation:** Never strips `www.` or other subdomains to apex, preserving exact Core specificity matching.
* **Pattern Loophole Closures:** Rejects empty host inputs (`/page.html`) for `EXACT_PAGE` and `PATH_PREFIX`; prohibits wildcards in `EXACT_PAGE` and query parameters in `PATH_PREFIX`.

### 2. Deep Import Sanitization & Deduplication (`src/core/validation/rules.ts`)
* **Envelope & Version Guard:** Validates envelope structure and rejects unsupported schema versions ($< 1$ or $> \text{CURRENT\_SCHEMA\_VERSION}=3$).
* **Deep Boundary Clamping:** Clamps schedule `startMinute` and `endMinute` to $[0, 1439]$, days to $[0, 6]$, whitelists pause types (`NONE`, `BREATHE`, `TIMER`, `CONFIRM`), clamps breathing/timer durations to $[0, 60]$, and validates `dailyLimitMs`.
* **Collection & Target ID Deduplication:** Deduplicates identical collection and target IDs on import to prevent corrupting in-memory engine maps.

### 3. Concurrency Defense & Canonical State Re-reading (`src/ui/options/options.ts`)
* Before committing collection or rule mutations (save, edit, delete), the Options controller re-reads fresh collections from background (`await loadCollections()`), preventing stale DOM state from overwriting concurrent modifications or throwing on deleted targets.

### 4. Accessibility & Motion Compliance
* **Focus Restoration:** Implements `rememberFocus()` and `restoreFocus()` across all dialog modals to restore keyboard focus to the triggering element upon close or Escape.
* **In-App Reduced Motion CSS:** Declares `:root[data-reduced-motion="true"] * { transition: none !important; animation: none !important; }` across all UI styles to instantly disable all animations and transitions when requested in settings.

---

## Phase 6: Momentary Access — Intent Passes Architecture

Phase 6 implements deliberate, user-facing temporary access ("Intent Passes") allowing users to consciously override a block for fixed durations without mutating rules, disabling schedules, or resetting daily limits:

### 1. Three Distinct Grant Concepts
Moment strictly distinguishes between three access concepts with distinct semantics, lifetimes, and scopes:

1. **`TemporaryAccessGrant` (`src/core/models/grant.ts`):**
   - **Internal plumbing mechanism:** Bridges completion of an intervention to the top-level navigation commit.
   - **Single-use:** Consumed atomically upon the top-level `onNavigationCommitted` event.
   - **Target-exact:** Scoped strictly to the target URL being navigated to.
   - **Short-lived:** Clamped to $\le 10$ minutes (typically consumed within 1-2 seconds).

2. **`SitePass` (`src/core/models/site-pass.ts`):**
   - **Internal post-intervention cooldown:** Prevents repeated interventions during normal browsing within a website after completing an intervention.
   - **Multi-use within duration:** Default 5 minutes.
   - **Website-scoped:** Covers the website/apex domain.
   - **Tab-isolated:** Scoped to the originating tab ID.

3. **`IntentPass` (`src/core/models/intent-pass.ts`):**
   - **User-facing product feature:** Deliberate, conscious decision by the user ("I genuinely need this site right now").
   - **Configured duration:** Fixed durations: 5 minutes, 15 minutes, or 30 minutes (hard max 30m; clamped/rejected otherwise).
   - **Tab-isolated:** Bound strictly to the tab ID where it was requested.
   - **Early Surrender:** User can voluntarily end the pass early via the popup.

### 2. Rule Scope Fidelity Invariant (Section 25)
An Intent Pass **never synthesizes a broader grant than the underlying matched rule**:
* **`WEBSITE` rule:** Produces a `WEBSITE` Intent Pass covering the entire apex domain and subdomains.
* **`EXACT_HOST` rule:** Produces an `EXACT_HOST` Intent Pass matching only that exact hostname (subdomains are not permitted).
* **`PATH_PREFIX` rule:** Produces a `PATH_PREFIX` Intent Pass matching only URLs under that path prefix. Other paths on the same host remain blocked.
* **`EXACT_PAGE` rule:** Produces an `EXACT_PAGE` Intent Pass matching only that exact URL path and query string.
* **`GLOB` rule:** Produces a `GLOB` Intent Pass matching only paths satisfying the bounded glob pattern.

Validation uses the pure domain `matchTarget` engine to evaluate synthetic targets matching the pass scope, guaranteeing 100% semantic fidelity.

### 3. Authoritative Background State Machine
- Clients cannot forge pass IDs, timestamps, durations, or scopes. All passes are minted by the background service worker on `REQUEST_INTENT_PASS`.
- Non-blocked sites cannot request an Intent Pass. Context is validated against active interventions or live policy evaluation.
- When an Intent Pass is requested from an intervention, the background atomically consumes the pending intervention and issues a single-use `TemporaryAccessGrant` so navigation commits seamlessly.

### 4. Navigation Evaluation Order
1. Non-web / extension schemes $\to$ `ALLOW`
2. `TemporaryAccessGrant` valid for tab & URL $\to$ `ALLOW` (consumed on navigation commit)
3. `IntentPass` valid for tab, URL scope, and unexpired $\to$ `ALLOW` (reason: `INTENT_PASS`)
4. `SitePass` valid for tab, site scope, and unexpired $\to$ `ALLOW` (reason: `SITE_PASS`)
5. Core Policy Engine evaluation (`engine.evaluate`) $\to$ `ALLOW`, `INTERVENE`, or `BLOCK`

### 5. Daily Limits & Active Accounting Interaction
- Active browsing time continues to accumulate in daily usage budgets during an active Intent Pass.
- An Intent Pass does not pause, reset, or extend daily budgets.
- If daily budget is exhausted during an Intent Pass, the active pass continues until expiration; subsequent navigations are blocked.

### 6. Persistence & MV3 Suspension Resilience
- `state.runtime.intentPasses` is persisted in `ExtensionStorage` (`storage.local`).
- Service worker restarts restore active passes without loss or truncation.
- Closing the tab cleans up associated Intent Passes immediately.

---

## Phase 7: Focus Mode Architecture

Phase 7 implements user-directed, deliberate Focus Mode commitment sessions that activate boundaries across chosen collections browser-wide without altering underlying collection schedules or resetting daily limits:

### 1. The Four Temporary Access / Focus Concepts in Moment

| Mechanism | Purpose | Scope | Lifetime | Mutates Config? |
| :--- | :--- | :--- | :--- | :---: |
| **`TemporaryAccessGrant`** | Navigation commit authorization | Tab-scoped, Target-exact | Single-use ($\le 10$m) | No |
| **`SitePass`** | Post-intervention cooldown | Tab-scoped, Website | 5 minutes | No |
| **`IntentPass`** | Deliberate override of block | Tab-scoped, Rule-faithful | 5m, 15m, 30m (max 30m) | No |
| **`FocusSession`** | Mindful focused work commitment | **Browser-wide** (all tabs/windows) | 15m, 30m, 60m, 90m, 120m (max 120m) | No |

### 2. Non-Mutating Dynamic Collection Activation
- **Underlying Configuration Remains Frozen:** Starting Focus Mode does **not** write to or modify `collection.boundary.schedule`. The user's recurring calendar schedules remain intact and pristine.
- **Dynamic Policy Composition:** In `MomentDecisionEngine.evaluate()`, a collection is evaluated as active if:
  $$\text{boundaryActive} = \text{isNormallyActive}(\text{schedule}, t) \lor \text{isFocusActive}(\text{focusSession}, \text{collectionId}, t)$$
- **Instant Clean Teardown:** When a Focus Session expires or is voluntarily ended, normal schedules resume immediately with zero state migrations, resets, or cleanup procedures.

### 3. Policy Precedence, Specificity & Invariants
1. **Specificity & Exception Supremacy:** Exception rules (`isException: true`) always win over Focus Mode restrictions per the Specificity Tuple comparison. Whitelisted work tools, documentation, or educational resources remain accessible during focus sessions.
2. **Daily Budget Priority:** If a collection's daily usage limit is reached during a focus session, `DAILY_LIMIT_EXHAUSTED` takes precedence over Focus Mode.
3. **Pass Compatibility:** An active `TemporaryAccessGrant`, `SitePass`, or `IntentPass` in a specific tab continues to authorize that tab without ending or disrupting the browser-wide focus session for other tabs and windows.
4. **Decision Reason:** When Focus Mode enforces a boundary, the decision reason is unambiguously reported as `'FOCUS_MODE'` with `trace.focusModeActive: true`.

### 4. Storage Persistence & MV3 Service Worker Resilience
- **Persistence:** Stored in `state.runtime.focusSession` in `ExtensionStorage` (`chrome.storage.local`).
- **Timestamp-Based Expiration:** Evaluated strictly using timestamps (`now >= expiresAt`), making expiration completely immune to service worker suspension, browser restarts, and memory eviction.
- **Autonomous Early Surrender:** The user retains full autonomy and can end the focus session early at any time without penalty, friction traps, or locked states.

---

## Phase 7.1: Theme Consistency & UI Polish Architecture

Phase 7.1 establishes a centralized, coherent design token architecture and fixes theme consistency across all Moment extension UI surfaces:

### 1. Root Cause & Browser CSS Engine Discard Fix
- **Parser Syntax Bug:** In `options.css`, a malformed selector `[data-theme="dark"], @media ...` caused standard CSS parsers (Gecko / Blink) to drop the entire `@media (prefers-color-scheme: dark)` rule block per CSS Syntax Level 3 specifications.
- **The Fix:** Separated pure at-rule `@media (prefers-color-scheme: dark)` from attribute selectors and consolidated all token variables in [`src/ui/theme.css`](file:///home/greenaltambe/Projects/Moment/src/ui/theme.css).

### 2. Pure Theme Resolver & Synchronization Engine ([`src/ui/theme.ts`](file:///home/greenaltambe/Projects/Moment/src/ui/theme.ts))
- **Deterministic Resolution:**
  - `LIGHT`: Always resolves to `'light'`
  - `DARK`: Always resolves to `'dark'`
  - `SEPIA`: Always resolves to `'sepia'`
  - `SYSTEM`: Strictly tracks OS / browser `prefers-color-scheme` (`'dark'` if true, `'light'` if false)
  - Invalid / null fallback: Safely defaults to `SYSTEM`
- **Zero White-Flash Initial Paint:** The default stylesheet evaluation applies dark tokens via `@media (prefers-color-scheme: dark)` immediately on HTML parse before any JavaScript execution.
- **Dynamic Cross-Tab Synchronization:**
  - Registers `window.matchMedia('(prefers-color-scheme: dark)')` listener to adapt instantaneously when the OS appearance toggles while pages are open.
  - Registers `chrome.storage.onChanged` listener so setting changes in Options reflect immediately across open Popups, Interventions, and Block pages without requiring extension reloads.

### 3. Coherent Color Tokens & Accessibility
- **WCAG Compliance:** Both Light (18.7:1), Dark (14.5:1), and Sepia (10.1:1) exceed WCAG AAA / AA contrast requirements for text, cards, borders, badges, and focus rings.
- **Native Form Controls:** Explicitly scoped `color-scheme` declarations (`light dark`, `dark`, `light`) ensure browser-native form inputs, selects, radios, checkboxes, and scrollbars render matching system controls.
- **Complete Surface Coverage:** Popup, Options Dashboard, Modals (Collection/Rule/Confirm), Focus Mode Drawer, Intervention Shell, and Block Page all link `theme.css` and consume semantic design tokens.

---

## Phase 8: Release Readiness & Robustness Architecture

Phase 8 hardens Moment against edge-case lifecycle crashes, storage corruption, and message forgery across 27 architectural lifecycle dimensions:

### 1. Storage Migration & Extreme Corruption Hardening
- **Sanitization Pipeline:** `migrateStorageState` sanitizes every incoming state section (`settings`, `collections`, `usage`, `runtime`) via discrete validators.
- **Non-Object Rejection:** Rejects raw arrays (`Array.isArray(raw)`), primitives, nulls, and malformed version numbers, defaulting safely to `DEFAULT_STORAGE_STATE`.
- **Collection Resilience:** Filters out null, non-object, or corrupt entries in the `collections` map. Ensures missing fields (`targets: []`, `boundary`, `enabled`) default safely.
- **Settings Fallbacks:** Malformed setting values (`theme`, `timeFormat`) fall back to default values without corrupting other settings.
- **Preservation Invariant:** Corrupted transient runtime state (e.g. invalid `focusSession` or `sitePasses`) is safely purged while preserving valid user collections, rules, and usage records.

### 2. Core Decision Engine & Boundary Evaluator Resilience
- **Null-Safe Collection Iteration:** Guarded `MomentDecisionEngine.resolveMatchingCollection` and `evaluate` loops against null or non-object collection items in `collectionsToEvaluate`.
- **Malformed Interval Defense:** `isTimeInInterval` strictly checks `!interval || typeof interval !== 'object' || !Array.isArray(interval.days)`, returning `false` rather than throwing when encountering corrupted schedule entries.

### 3. Background Error Containment & State Hygiene
- **Asynchronous Callback Containment:** Wrapped `adapter.onNavigation`, `adapter.onNavigationCommitted`, and `adapter.onTabRemoved` callbacks in `try...catch` blocks to prevent unhandled promise rejections during abrupt tab closures.
- **Focus Session Collection Pruning:** In `DELETE_COLLECTION`, when a collection is deleted, it is atomically removed from `focusSession.selectedCollectionIds`. If no selected collections remain, the focus session is automatically cleared to prevent ghost sessions.
- **Cross-Tab Spoofing Defense:** In `COMPLETE_INTERVENTION` and `CANCEL_INTERVENTION`, verified that if `_sender?.tab?.id` is defined, it strictly matches `message.tabId`.

### 4. AMO Compliance & Zero-Telemetry Privacy Specification
- **AMO Data Consent Requirement:** Under Mozilla Add-ons policies, extensions must declare their data collection posture in `browser_specific_settings.gecko.data_collection_permissions`.
- **Platform Minimum Version Requirements:** Built-in data collection consent was introduced in Firefox Desktop 140.0 and Firefox for Android 142.0. To ensure flawless validation without compatibility warnings, minimum versions are pinned accordingly.
- **Constitutional Zero-Knowledge Invariant:** Because Moment collects zero personal data, zero analytics, zero browsing telemetry, and transmits zero data over the network, `manifest/firefox/manifest.json` declares:
  ```json
  "browser_specific_settings": {
    "gecko": {
      "id": "moment@moment.local",
      "strict_min_version": "140.0",
      "data_collection_permissions": {
        "required": ["none"]
      }
    },
    "gecko_android": {
      "strict_min_version": "142.0"
    }
  }
  ```
- **Zero-innerHTML Security Invariant:** To satisfy strict AMO review criteria and eliminate script injection attack surfaces, dynamic UI views (Options dashboard and Popup) use safe DOM APIs (`document.createElement`, `textContent`, `replaceChildren`, `dataset`) with zero assignments to `innerHTML`.
- **Architectural Enforcement:** Enforced by `scripts/lint.js` (Invariants 4 & 5) and automated regression tests (`tests/unit/phase5_1_1_regression.test.ts`) to prevent regression across future builds.





