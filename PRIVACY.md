# Privacy Policy & Architecture

**Effective Date:** September 2026  
**Project:** Moment Browser Extension

Moment is designed around a simple, inviolable principle: **your browsing habits and personal data belong exclusively to you.**

This document provides a technical and operational explanation of Moment's privacy model and data handling practices.

---

## 1. Local-First Design

* **Zero Remote Servers**: Moment does not operate external servers, cloud databases, user account systems, or authentication endpoints.
* **On-Device Storage**: All rules, collections, user preferences, daily active durations, and temporary authorization tokens are stored exclusively on your device via the browser's `chrome.storage.local` API.
* **Offline Operation**: Moment functions completely without an internet connection. It never makes outbound network requests during installation, configuration, or active use.

---

## 2. Browsing Data & URL Handling

* **Zero Browsing History Logging**: Moment does not record visited URLs, page titles, browsing timestamps, or navigation history.
* **In-Memory Policy Evaluation**: When you navigate to a webpage, the background process compares the destination URL in memory against your configured collection rules. Once the policy decision is rendered (allow, intervene, or block), the URL is immediately discarded.
* **Daily Usage Aggregation**: When a collection is configured with a daily browsing limit, Moment tracks only the **cumulative active seconds** spent on matching sites for that calendar day, stored as a simple duration counter (e.g., `2026-09-14:col_social -> 420 seconds`). Individual sites or visits within that collection are not tracked or saved.

---

## 3. Telemetry, Analytics & Remote Resources

* **Zero Telemetry**: Moment contains no telemetry frameworks, metrics collectors, or pingbacks.
* **Zero Third-Party Analytics**: No Google Analytics, Mixpanel, Sentry, or third-party trackers are integrated.
* **No Remote Scripts or Fonts**: All styles, icons, scripts, and HTML templates are bundled locally within the extension package. No remote scripts, stylesheets, fonts, or images are loaded.
* **Strict Content Security Policy (CSP)**: Extension pages enforce:
  ```text
  default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none';
  ```
  This prohibits inline script injection, external styling, and dynamic code evaluation (`eval`).

---

## 4. Temporary Passes and State Hygiene

* **SitePass & IntentPass Tokens**: Temporary unlock passes granted after completing an intervention are stored in local extension runtime state.
* **Expiration**: Upon expiration, passes are automatically purged from local storage.
* **Tab Scoping**: When configured to "This tab only", the temporary pass is bound to the specific browser tab ID and expires immediately if the tab is closed.

---

## 5. Data Export & Backup

* **User Controlled**: You may export your entire configuration (collections, rules, and preferences) as a JSON file at any time via the Options page.
* **Plain Text Transparency**: Exported files contain only human-readable JSON representing your configured rules and preferences. No hidden machine identifiers or session credentials are included.

---

## 6. Permissions

Moment requests only the minimum permissions necessary to enforce your configured boundaries:
* `storage`: Persist your rules and settings locally.
* `tabs`: Check active tab URLs against rules and compute active browsing time.
* `webNavigation`: Intercept top-level navigations before restricted pages load.
* `alarms`: Schedule pass expiration timers and interval flushes in MV3.

---

## 7. Contact & Inquiries

For questions regarding Moment's privacy implementation or to audit the source code, please visit the project repository on GitHub:  
[https://github.com/Moment-Project/Moment](https://github.com/Moment-Project/Moment)
