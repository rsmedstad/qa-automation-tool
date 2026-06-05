# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## 2026-06-05

### Added
- **Yellow "Known Issue" result status** — a third state between Pass and Fail for
  *known, accepted* limitations (rendered yellow on the dashboard, separate from red
  failures). Surfaces in `summary.json` as `knownIssueCount` / `knownIssueSummary` /
  `knownIssueUrls` and as a "Known Issues" column + trend series on the dashboard.
- **Geo-mismatch detector** — warns (`[GEO-MISMATCH]`) and marks a page's tests as
  Known Issue when a region URL silently lands on a different locale (see Notes).
- **TC-15 (DocCheck login)** — passes when the DocCheck login iframe populates on
  HCP-gated pages (e.g. the de-de DatScan page).
- **TC-16 (regional microsite)** — dismisses the language + geo-location modals on
  product microsites (e.g. `gehealthcare-ultrasound.com`) and confirms the page loads.
- **Keepalive workflows** in both `qa-automation-tool` and `qat-artifacts` to prevent
  GitHub from auto-disabling the scheduled workflows after 60 days of inactivity.

### Fixed
- **TC-07 / TC-08** — replaced `page.waitForLoadState('networkidle')` (which never
  settled on GE's always-active pages) with `domcontentloaded`; both tests now pass.
- **Input URL list** — repointed 27 stale pre-migration URLs to their canonical
  post-migration paths (`/en-us/`, `/fr-fr/`, `/en-in/`, etc.).
- **Vercel KV cleanup** — corrected the Upstash REST calls (path-form `/scan/{cursor}`
  and `/del/...`) and kept the 64-bit SCAN cursor as a string; the job had silently
  never deleted anything.
- **qat-artifacts cleanup** — rewrote the age check to use each run's `metadata.json`
  timestamp instead of filesystem mtime (which `checkout` resets); purged ~928 stale
  run folders that had accumulated since the job never matched anything.
- **Cleanup workflows** — removed `|| true` that was swallowing cleanup-script failures.

### Changed
- **CI hardening** — `run-qa` passes `workflow_dispatch` inputs via `env:` instead of
  interpolating into shell (script-injection), stopped logging secret prefixes, and
  added least-privilege `permissions:` blocks.
- **Node 24 / action upgrade** — bumped `checkout`/`setup-node`/`cache`/`upload-artifact`/
  `download-artifact` to current majors and scripts to Node 22, ahead of GitHub forcing
  the Node 24 action runtime.
- **Anti-headless masking** — realistic User-Agent + `navigator.webdriver` masking on
  all browser contexts (fidelity improvement; see Notes).

### Notes — why "Known Issue" (yellow) appears
GE Healthcare serves a **client-side GeoIP redirect**: from a US IP, region pages
(e.g. `/de-de`, `/en-gb`, `/fr-fr/…`, `/en-in/…`) can bounce to `/en-us`. A real US
browser (even fresh incognito) stays on the region page, but the **headless CI runner**
gets redirected — so those pages can't be validated as their locale from CI. This is
**not a regression**; it's the same headless/automation behavior behind GE's known
404-in-headless issue. Affected pages are now flagged **yellow (Known Issue)** rather
than counted as false-green passes or red failures. The count is **flaky run-to-run**
(the redirect is inconsistent), which honestly reflects how often the CI runner is
bounced. TC-13 (the de-de homepage nav test) is the canonical example.
