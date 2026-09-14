# Moment — Usage Accounting & Active Tab Time Tracking (Phase 4)

This document details the architectural design, invariants, domain models, and operational semantics of **Phase 4: Usage Limits, Cumulative Time Budgets & Active Tab Tracking** in Moment.

---

## 1. Core Philosophy & Definition of Active Time

Unlike traditional spyware-like analytics trackers that continuously log URLs, browsing history, and background tabs, Moment adheres strictly to its **local-first, privacy-respecting, zero-knowledge architecture**:

* **Zero URL Logging:** Specific URLs, visit histories, and browsing trails are never logged or stored.
* **Aggregated Daily Usage Counters:** Only the cumulative duration spent actively browsing each collection is stored, keyed exclusively by the local calendar date and collection ID (`${dateKey}:${collectionId}`).
* **Active Browsing Time Definition:** Active time accumulates **only** when all of the following conditions are simultaneously met:
  1. The tab is the **active tab** in its browser window.
  2. The browser window containing the tab is **actively focused** by the user (or on platforms like Firefox Android where window focus APIs are unavailable, foreground app execution is verified).
  3. The active tab is loaded with an **eligible web URL** (`http:` or `https:`) matching an active collection restriction.
  4. The target URL is **not an exception rule** (exceptions are exempt from limits and time accounting).

Internal extension pages (`chrome-extension://`, `moz-extension://`), system pages (`about:`, `chrome://`), non-web protocols, and inactive background tabs **never** accumulate browsing time.

---

## 2. Invariants & Clock Protection

### 2.1 Interval-Based Timestamp Accounting (Zero 1-Second Ticks)
Moment does **not** run a continuous, battery-draining 1-second interval loop. Instead, it utilizes **discrete event-driven timestamp accounting**:
$$\Delta t = \text{now} - \text{lastCheckpointTimestamp}$$
Elapsed time is evaluated and committed on specific browser events:
* Tab activation (`onTabActivated`)
* Window focus change (`onWindowFocusChanged`)
* Top-level navigation (`onNavigation`)
* Tab closure (`onTabRemoved`)
* Periodic checkpoint flush (every 25 seconds during active service worker lifecycle)
* Explicit user query (opening the extension popup UI)

### 2.2 Machine Sleep & OS Suspension Clamping
When a user closes their laptop lid, locks the OS, or the system hibernates, no browser events fire during the sleep period. When the machine wakes up hours later, a naive subtraction ($\text{now} - \text{lastCheckpointTimestamp}$) would incorrectly treat hours of sleep as active browsing time.
* **The Invariant:** Every discrete active delta is strictly clamped to:
  $$\Delta t_{\text{clamped}} = \min(\Delta t, \text{MAX\_DISCRETE\_ACTIVE\_DELTA\_MS})$$
  where $\text{MAX\_DISCRETE\_ACTIVE\_DELTA\_MS} = 60\,000\text{ms}$ (60 seconds).
* **Limitations of the 60-Second Clamp:**
  The 60-second clamp is **not** an infallible sleep or idle detector. Browser extension APIs provide discrete lifecycle events (`onActivated`, `onFocusChanged`, `onNavigation`, `onRemoved`), but do not provide a direct hardware sleep signal.
  Conceptually, the system distinguishes states as follows:
  - **User actively interacting with tab:** Inferred from tab being active in focused window with eligible web URL. Moment intentionally **does not track keystrokes or mouse activity** to protect user privacy.
  - **Browser window unfocused:** Accurately detected via `onWindowFocusChanged(-1)`. Time accumulation stops immediately.
  - **Tab inactive:** Accurately detected via `onTabActivated`. Time accumulation on old tab flushes immediately.
  - **Service worker suspended:** Extension service workers are ephemeral. While dormant, no timer ticks run. Upon wakeup/boot, tracker reconciles current state.
  - **Browser / Machine suspended (sleep/hibernation):** No JavaScript execution occurs during sleep. Upon wake, the elapsed gap is bounded by the 60s clamp. The system cannot distinguish between a user quietly reading a static page for 60 seconds vs. the machine sleeping for 3 hours; both receive at most 60 seconds of attributed active time.

### 2.3 System Clock Rollback Defense
If the host operating system clock moves backward (e.g., NTP resynchronization, manual clock adjustment, or daylight savings adjustments):
* **The Invariant:** If $\text{currentTimestamp} \le \text{lastCheckpointTimestamp}$, the calculated delta is safely clamped to $0$:
  $$\Delta t = 0$$
  The checkpoint timestamp is immediately updated to $\text{now}$ without corrupting or deducting existing usage records.

### 2.4 Local Calendar Midnight Rollover & Timezones
Daily usage budgets reset cleanly at **local midnight ($00:00:00$)** in the host device's local timezone.
* **The Midnight Split:** If an active browsing interval spans across local midnight (e.g., 23:59:45 to 00:00:15):
  The pure helper `splitIntervalAtMidnight(startMs, endMs)` slices the interval at the midnight boundary:
  - Slice 1 (Pre-Midnight): 15,000ms attributed to yesterday's date key (`YYYY-MM-DD`).
  - Slice 2 (Post-Midnight): 15,000ms attributed to today's date key (`YYYY-MM-DD`).
* **Timezone Shifts & Daylight Saving Time (DST):**
  Date keys (`YYYY-MM-DD`) and midnight transitions are derived from the local runtime environment via `Date.getFullYear()`, `getMonth()`, and `getDate()`. On DST transition days (spring-forward 23-hour days or fall-back 25-hour days), JavaScript local date math resolves the midnight boundary cleanly. Historical timezone reconstruction is not performed.

---

## 3. Active Context Exclusivity

The tracker maintains **at most one active accounting context** across the entire browser at any instant based on available browser activation and focus signals:
* **Exclusivity Invariant:** Time accumulates only for the single active tab within the single currently focused browser window.
* When Window 1 loses focus (`onWindowFocusChanged(-1)`), accumulation ceases completely.
* When Window 2 gains focus (`onWindowFocusChanged(win2)`), only the active tab in Window 2 accumulates time.
* Total across the browser is strictly bounded: 1 second of wall-clock time can never produce more than 1 second of recorded usage across all collections.

---

## 4. Policy Engine Integration & Intent Pass Co-existence

### 4.1 Decision Pipeline Evaluation
When a top-level navigation occurs, `MomentDecisionEngine.evaluate()` evaluates daily limits:
1. **Grant Check (Step 1):** If the tab possesses an active, unexpired Temporary Access Grant (Intent Pass), the navigation is granted **immediate `ALLOW` with `ACTIVE_GRANT`**.
   > **Intent Pass Co-existence Invariant:** An ongoing Intent Pass permits navigation and session access (up to the 10-minute maximum grant duration) even if the collection's daily time budget is already exhausted. Usage continues to accumulate toward the collection while the grant is active. The grant does not reset usage, extend the daily budget, or create a permanent allow. Once the grant is consumed or expires, subsequent navigations encounter the exhausted limit.
2. **Rule Matching & Precedence (Steps 2–5):** Evaluated strictly according to the Phase 2.1 Lexicographic Specificity Tuple algorithm. Exceptions do **not** automatically dominate restrictions; higher specificity always wins. An exception only wins if its specificity tuple is higher than or equal to competing restrictions. When an exception wins, it returns `ALLOW` (`EXCEPTION_RULE`) and is exempt from collection restrictions and usage limits.
3. **Usage Budget Evaluation (Step 6):** If the winning candidate is an active restriction and a daily limit is configured:
   - Evaluates used time today against the configured limit:
     $$\text{isExhausted} = (\text{usedMs} \ge \text{limitMs})$$
   - If exhausted, the engine returns:
     $$\text{reason: 'DAILY\_LIMIT\_EXHAUSTED'}$$
   - **Action Determination:**
     - If the collection boundary is configured with Pause / Intervention (`BREATHE`, `TIMER`, `CONFIRM`): returns `action: 'INTERVENE'`.
     - If the collection boundary is configured for Terminal Block (`pause.type === 'NONE'`): returns `action: 'BLOCK'`.

---

## 5. Storage Architecture (Schema Version 3)

The persistent storage envelope is versioned at `CURRENT_SCHEMA_VERSION = 3`:

```typescript
export interface DailyUsageRecord {
  readonly dateKey: string;     // Local calendar date 'YYYY-MM-DD'
  readonly collectionId: string;// Target collection identifier
  accumulatedMs: number;        // Total elapsed active milliseconds
  updatedAt: number;            // Epoch millisecond timestamp of last update
}

export interface MomentStorageEnvelope {
  readonly schemaVersion: 3;
  readonly settings: UserSettings;
  readonly collections: Record<string, Collection>;
  readonly usage: Record<string, DailyUsageRecord>; // Key: `${dateKey}:${collectionId}`
  readonly runtime: RuntimeState;
}
```

Migrations from `v1 -> v3` and `v2 -> v3` are handled automatically and deterministically by `migrateStorageState()`.

---

## 6. Popup UI & Accessibility

The extension popup (`src/ui/popup/`) provides a calm, accessible usage summary for the currently active tab:
* **Current Location:** Sanitized host domain display.
* **Usage Card:**
  - Collection name label and status badge (`"30m limit"`, `"Limit reached"`, `"No limit"`).
  - Time spent today formatted calmly (`"12m"`, `"1h 5m"`).
  - Time remaining when a budget applies (`"18m remaining"`).
  - Accessible progress bar showing budget consumption.
  - High-contrast alert notice when daily limit is exhausted.
* **Accessibility:** Declares `aria-live="polite"`, WCAG AA contrast, and respects `prefers-reduced-motion`.

---

## 7. Verification & Invariant Audit

* **Unit Test Suites:**
  - `tests/unit/usage_accounting.test.ts`: Pure accounting functions, fake clock harness, clamping, rollback, midnight splitting, duration formatting.
  - `tests/unit/usage_tracker.test.ts`: Active tab tracking, multi-window switching, sleep clamping, midnight rollover, query summaries.
  - `tests/unit/policy_engine.test.ts`: Decision engine limit exhaustion, Intent Pass co-existence, exception precedence.
* **Architectural Linter:** Enforces zero browser imports in `src/core/`, strict CSP in UI, and `window.location.replace` invariant.
