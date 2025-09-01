![Proprietary](https://img.shields.io/badge/license-Proprietary-red)

# QA Automation Tool

A centralized platform for automating web-application quality assurance.
Runs a predefined suite of end-to-end checks, aggregates results in real time, and presents trends on a clean dashboard.

[Live Dashboard →](https://qa-automation-tool.vercel.app/)

![Dashboard Preview](./assets/dashboard-preview.png)

---

## Status & CI

- **Scheduled tests**: every 3 hours via GitHub Actions  
- **Cleanup tasks**: every 3 days (Supabase & Vercel KV)
- **Preview DB keepalive**: every 3 days (test Supabase)
- **Coverage**:  
  - Playwright tests for page structure, functionality and performance  
  - Manual-mode support via Excel input

[![Run QA Tests](https://github.com/rsmedstad/qa-automation-tool/actions/workflows/run-qa.yml/badge.svg)](https://github.com/rsmedstad/qa-automation-tool/actions/workflows/run-qa.yml)  
[![Data Cleanup](https://github.com/rsmedstad/qa-automation-tool/actions/workflows/cleanup.yml/badge.svg)](https://github.com/rsmedstad/qa-automation-tool/actions/workflows/cleanup.yml)

### Preview DB Keepalive

The workflow **Keep Test Supabase Alive** inserts a heartbeat row every three days using `scripts/keepalive-test-supabase.js`. It expects `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_ROLE_KEY` secrets. The script writes to a small `keepalive` table and prunes old rows to show ongoing activity. If that table doesn't exist, it falls back to a simple read query so the database still registers usage.

---

## Overview

The QA Automation Tool:

- **Executes** a comprehensive set of UI and workflow checks across target URLs  
- **Stores** results, progress and artifacts (screenshots, videos when needed) in Supabase and Vercel KV  
- **Visualizes** outcomes and trends in an interactive Next.js dashboard  
- **Enables** ad-hoc and scheduled runs, with AI-driven query support via Gemini  

---

## Technology Stack

| Layer         | Framework / Service                    |
|---------------|----------------------------------------|
| Application   | Node.js, Next.js                       |
| Automation    | Playwright                             |
| Data Storage  | Supabase (Postgres) & Vercel KV        |
| CI / Delivery | GitHub Actions, Vercel                 |
| Reporting     | Chart.js, ExcelJS                      |
| AI Insights   | Gemini with LangChain                  |

---

## Key Features

### Dashboard

- **Recent Runs**: pass/fail/N-A counts, trend charts, artifact links  
- **Ask Gemini**: natural-language queries (passphrase-protected)  
- **Ad-hoc Execution**: submit name, passphrase, optional Excel; trigger tests immediately  

### Scheduling & Cleanup

- **Run QA**: every 3 hours (cron)  
- **Cleanup**: Supabase & KV data older than 60 days, every 3 days  

### Manual Validation

- **Screaming Frog** tab outlines steps to replicate tests manually (requires paid license)  

---

## Test Definitions & Protocol

| ID      | Name                        | Description                                          |
|---------|-----------------------------|------------------------------------------------------|
| **TC-01** | Hero Overlay on Desktop    | Hero text visible at 1920×1080 for homepage, category, product and custom hero banners |
| **TC-02** | Hero Static on Mobile      | Hero text visible on 375×667 viewport for homepage, category, product and custom hero banners |
| **TC-03** | Header Presence            | `<header>` or class containing “header”              |
| **TC-04** | Navigation Presence        | `<nav>` or class containing “nav”                    |
| **TC-05** | Main Content               | `<main>` or class containing “main”                  |
| **TC-06** | Footer Presence            | `<footer>` or class containing “footer”              |
| **TC-07** | Main Video & Carousel      | `<video>` or Vidyard iframe; play button opens modal; carousel videos show no "Video Not Found" |
| **TC-08** | Contact Form Opens         | “Contact” button launches form overlay               |
| **TC-09** | Rendering Error Check      | No “A rendering error occurred” text                 |
| **TC-10** | Gatekeeper Redirect        | Incognito + “Yes” click yields 200 status            |
| **TC-11** | Insights Link Works        | First insights/newsroom link returns HTTP 200        |
| **TC-12** | DocCheck Login Route       | Incognito → URL includes `/account/doccheck-login`   |
| **TC-13** | DE Nav Redirect            | “Produkte → Ultraschall → Mehr erfahren” → target site |
| **TC-14** | HTTP Status Code Valid     | Status 200 or valid redirect (301/302)               |

Supported hero components for **TC-01**:
- `div[id*="ge-homepage-hero"]`
- `.ge-homepage-hero-v2-component`
- `.ge-category-hero__container`
- `.hero-content-intro`
- `.product-heroV2-container`

### Method Summary

Both **TC-01** and **TC-02** use the `heroTextVisible` helper from `utils/hero.js`.
The script iterates over the selectors above and returns `true` once any hero
text element is visible. TC‑01 runs at a **1920×1080** viewport, while TC‑02
sets a **375×667** mobile viewport before checking visibility.

### Screaming Frog Emulation

Screaming Frog cannot verify viewport‑specific behavior such as overlays, but it
can confirm whether a hero element exists. Use **Custom Extraction** and create
an extraction with a regular expression covering the selectors listed above,
e.g. `div\[id*="ge-homepage-hero"\]` or `section\.ge-homepage-hero-v2-component`.
After crawling, review the “Extraction” tab to see URLs containing these hero
elements.

For details and any custom extraction, use the dashboard’s **Test Definitions** section.

---

## Internal Use & Contact

This repository is public for transparency but intended **only** for internal use.  
For assistance, please reach out via company channels (Teams/Outlook).

---

## License

All rights reserved © Ryan Smedstad.  
Unauthorized copying, modification or distribution is prohibited.
Last updated: 2025-09-01
