# Moment Release Procedure

This document describes the step-by-step procedure for building, verifying, and packaging a new release of Moment for GitHub, Mozilla Add-ons (AMO), and the Chrome Web Store.

---

## 1. Version Bump & Verification

1. **Update Version Number**:
   Ensure the version is incremented consistently across:
   * `package.json`
   * `manifest/firefox/manifest.json`
   * `manifest/chrome/manifest.json`
   * `src/ui/options/options.html` (sidebar and diagnostics fallback displays)

2. **Update Documentation**:
   * Record new changes in [CHANGELOG.md](CHANGELOG.md).
   * Confirm documentation reflects any updated requirements.

---

## 2. Automated Quality Checks

Run the automated test suite and architectural verification commands:

```bash
# 1. Verify architectural invariants (CSP, Core isolation, AMO data collection permissions)
npm run lint

# 2. Typecheck all TypeScript sources and tests
npm run typecheck

# 3. Execute all unit and integration test suites
npm test
```

All commands must exit with code `0`.

---

## 3. Build & Package Artifacts

Build the distribution bundles and generate signed-ready zip archives:

```bash
# Clean build of Chrome and Firefox unpacked distributions
npm run build

# Package Firefox add-on (dist/addon.zip) and AMO source code archive (src.zip / dist/source.zip)
npm run pack
```

---

## 4. Archive Inspection

Inspect the generated archives to confirm proper structure:

```bash
# Verify Firefox addon archive contains manifest.json at root
unzip -l dist/addon.zip | head -n 10

# Verify AMO source archive contains root manifest and source files
unzip -l src.zip | head -n 15
```

Ensure neither archive contains:
* `node_modules/`
* `.git/`
* `dist/`
* Temporary files or `.DS_Store`
* Hardcoded local filesystem paths

---

## 5. Local Smoke Testing

Before uploading, test the unpacked distribution in a real browser:

1. In Firefox:
   * Navigate to `about:debugging` -> **This Firefox** -> **Load Temporary Add-on...**.
   * Select `dist/firefox/manifest.json`.
   * Verify popup opens, settings save, interventions trigger on test rules, and themes render properly.
2. In Chrome:
   * Navigate to `chrome://extensions` -> enable **Developer mode** -> **Load unpacked**.
   * Select `dist/chrome`.
   * Verify service worker activates and navigation blocking works.

---

## 6. Git Tag & GitHub Release

1. **Commit release changes**:
   ```bash
   git add -A
   git commit -m "Release v1.2.1"
   ```

2. **Tag release**:
   ```bash
   git tag -a v1.2.1 -m "Moment v1.2.1"
   ```

3. **Push to GitHub** (when ready to publish):
   ```bash
   git push origin main --tags
   ```

4. **Create GitHub Release**:
   * Create a new release referencing the tag.
   * Attach `dist/addon.zip` and `dist/source.zip` as downloadable assets.
   * Copy the relevant release section from `CHANGELOG.md` as the release notes.

---

## 7. Submit to Mozilla Add-ons (AMO)

1. Log into the [Mozilla Add-on Developer Hub](https://addons.mozilla.org/developers/).
2. Select Moment (or submit a new add-on).
3. Upload `dist/addon.zip` as the extension package.
4. When prompted whether the extension uses minified or transpiled source code, select **Yes**.
5. Upload `dist/source.zip` (or `src.zip`) as the source code archive.
6. Provide build instructions in the reviewer notes (refer to [docs/AMO_LISTING.md](docs/AMO_LISTING.md)).
7. Confirm and submit for review.
