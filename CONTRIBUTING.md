# Contributing to Moment

Thank you for your interest in contributing to Moment!

Moment is an open-source, local-first browser extension designed to cultivate digital mindfulness through intentional, compassionate friction. We welcome contributions that align with our philosophy of user agency, strict privacy, and clean software craftsmanship.

---

## Development Setup

### 1. Prerequisites
* [Node.js](https://nodejs.org/) v18.0.0 or higher
* [npm](https://www.npmjs.com/) v9.0.0 or higher

### 2. Fork & Clone
```bash
git clone https://github.com/Moment-Project/Moment.git
cd Moment
npm install
```

### 3. Verification Commands
Before submitting changes, ensure all quality checks pass cleanly:
```bash
npm run lint        # Verifies architectural invariants and strict CSP rules
npm run typecheck   # Performs full TypeScript type validation
npm test            # Runs all unit and integration test suites
npm run build       # Transpiles and creates unpacked Chrome & Firefox bundles
```

---

## Architectural Guidelines

Moment enforces strict separation of concerns:

### 1. Core Layer (`src/core/`)
* **Zero Browser Imports**: The core module contains pure business logic and must never import `chrome.*`, `browser.*`, or browser adapter modules.
* **Deterministic Behavior**: All core functions (decision engine, pattern matchers, schedule evaluators, grant validators) must be deterministic and testable without browser mocks.

### 2. Browser Layer (`src/browser/`)
* Implements the `BrowserAdapter` contract to normalize differences between Chrome's MV3 Service Worker and Firefox's MV3 Background Scripts.
* All browser API calls should pass through or be mediated by the appropriate adapter.

### 3. User Interface (`src/ui/`)
* **Strict CSP Invariant**: Absolutely no inline `<script>` tags, no inline `style="..."` attributes, and no `eval()` or `new Function()`.
* **Zero `.innerHTML`**: Never assign to `element.innerHTML`. Use `document.createElement`, `textContent`, or `replaceChildren()` to prevent XSS vulnerabilities.
* **Responsive Design**: All UI views (Popup, Options, Intervene, Block) must support viewports down to 320px for mobile ergonomics (Firefox Android).

### 4. Background & Lifecycle (`src/background/`)
* Implements navigation routing, lifecycle events, and discrete active time tracking.
* Must handle asynchronous service worker restarts gracefully without state corruption.

---

## Testing Guidelines

* Moment uses Node.js's built-in test runner (`node:test` and `node:assert/strict`). No third-party test framework is required.
* New features or bug fixes must include corresponding tests in `tests/unit/`.
* Test files must be named `*.test.ts`.

---

## Pull Request Process

1. **Create a branch**: Branch off `main` with a descriptive name (e.g., `feature/improved-timer`, `fix/schedule-boundary`).
2. **Adhere to Code Style**: Maintain consistency with existing TypeScript conventions and file organization.
3. **Run Validation**: Run `npm run lint`, `npm run typecheck`, and `npm test`. All checks must pass.
4. **Submit PR**: Open a pull request with a concise description of your change, why it is needed, and how it was verified.
