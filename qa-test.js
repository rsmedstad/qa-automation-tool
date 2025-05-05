#!/usr/bin/env node
/*───────────────────────────────────────────────────────────────────────────────
  qa-test.js
  ----------
  • Reads workbook (URLs / empty Results + Metadata)
  • Runs Playwright checks (desktop + mobile) based on Test IDs specified per URL
  • Writes Pass/Fail matrix and fills Metadata
  • Captures screenshots for failed tests
  • Includes TC-09: Declared Rendering Error
  • Test definitions are documented in README.md
───────────────────────────────────────────────────────────────────────────────*/

import os from 'os';
import XLSX from 'xlsx';
import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

try {
  /* everything that follows runs inside an async IIFE so we can use await */
  (async () => {
    /*──────────────────────────── 1. CLI / filenames ─────────────────────────────*/
    // Step 1: Parse command-line arguments for input file, output file, and initiator
    console.log('Starting QA test script');
    const [,, inputFile, maybeOut, maybeBy] = process.argv;
    if (!inputFile) {
      console.error('Usage: node qa-test.js <input.xlsx> [output.xlsx] [Initiated By]');
      process.exit(1);
    }
    const initiatedBy = maybeBy || os.userInfo().username;
    const outputFile = maybeOut ||
      `results-${new Date().toISOString().replace(/[:.]/g, '-')}-${initiatedBy}.xlsx`;

    console.log(`\n▶ Workbook  : ${inputFile}`);
    console.log(`▶ Output    : ${outputFile}`);
    console.log(`▶ Initiated : ${initiatedBy}\n`);

    /*──────────────────────────── 2. Load workbook data ──────────────────────────*/
    // Step 2: Validate and load the input Excel file
    console.log('Checking file content...');
    const fileContent = fs.readFileSync(inputFile, 'utf8');
    console.log('File content (first 100 chars):', fileContent.substring(0, 100));
    if (fileContent.startsWith('{')) {
      console.error('Error: input.xlsx is not an Excel file. Contents:', fileContent);
      process.exit(1);
    }

    console.log('Reading Excel file...');
    const wb = XLSX.readFile(inputFile, { cellStyles: true });
    console.log('Sheet names:', wb.SheetNames); // Debug: Log all sheet names

    // Check for required sheets: URLs, Metadata, Results
    const requiredSheets = ['URLs', 'Metadata', 'Results'];
    for (const sheet of requiredSheets) {
      if (!wb.SheetNames.includes(sheet)) {
        console.error(`Required sheet "${sheet}" not found. Available sheets:`, wb.SheetNames);
        process.exit(1);
      }
    }

    // Convert "URLs" sheet to JSON format
    const urlSheet = wb.Sheets['URLs'];
    const urlJsonData = XLSX.utils.sheet_to_json(urlSheet);
    console.log('First 5 rows of URLs sheet:', urlJsonData.slice(0, 5)); // Debug: Log first 5 rows

    // Extract URLs and their specified test IDs
    const urls = urlJsonData.map(row => ({
      url: row['URL'],
      testIds: (row['Test IDs'] || '').split(',').map(id => id.trim()).filter(Boolean)
    }));
    console.log('Extracted URLs with Test IDs:', urls); // Debug: Log the extracted URLs and test IDs

    if (!urls.length) {
      console.error('No URLs found.');
      process.exit(1);
    }

    // Define all possible test IDs (updated with new TC-09 and renumbered tests)
    const allTestIds = [
      'TC-01', 'TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06', 'TC-07', 'TC-08',
      'TC-09', 'TC-10', 'TC-11', 'TC-12', 'TC-13', 'TC-14'
    ];

    /*──────────────────────────── 3. Seed empty results ─────────────────────────*/
    // Step 3: Initialize results array with default values for each URL
    const results = urls.map(u => {
      const row = { URL: u.url };
      allTestIds.forEach(id => (row[id] = 'NA')); // Initialize all test results as NA
      row['HTTP Status'] = '-'; // Column for HTTP status
      row['Page Pass?'] = 'Not Run';
      return row;
    });

    /*──────────────────────────── 4. Playwright contexts ─────────────────────────*/
    // Step 4: Set up Playwright browser contexts for desktop and mobile testing
    const screenshotDir = 'screenshots';
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir);
    }

    const browser = await chromium.launch();
    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const mobileCtx = await browser.newContext(devices['Pixel 5']);

    /*──────────────────────────── 5. Helpers ─────────────────────────────────────*/
    // Helper constants and functions
    const HTTP_REDIRECT = [301, 302]; // HTTP status codes for redirects

    /**
     * Scrolls the page one viewport at a time until any of the specified selectors become visible.
     * @param {Page} page - The Playwright page object.
     * @param {string[]} selectors - Array of CSS selectors to check for visibility.
     * @param {number} maxScreens - Maximum number of viewports to scroll before giving up.
     * @returns {string|null} The selector that became visible, or null if none were found.
     */
    async function scrollAndFind(page, selectors, maxScreens = 10) {
      const viewH = await page.evaluate(() => window.innerHeight);
      for (let pass = 0; pass < maxScreens; pass++) {
        for (const sel of selectors)
          if (await page.$(sel)) return sel; // Return the first visible selector
        await page.evaluate(vh => window.scrollBy(0, vh), viewH);
        await page.waitForTimeout(500); // Wait for lazy-loaded content
      }
      return null;
    }

    /**
     * Performs a JavaScript-level click on an element, even if it's off-screen.
     * @param {Page} page - The Playwright page object.
     * @param {string} selector - The CSS selector of the element to click.
     * @returns {boolean} True if the element was found and clicked, false otherwise.
     */
    async function jsClick(page, selector) {
      return page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }, selector);
    }

    /*──────────────────────────── 6. Per-URL runner ─────────────────────────────*/
    /**
     * Runs all specified tests for a single URL.
     * @param {Object} urlData - Contains the URL and its specified test IDs.
     * @param {number} idx - The index of the URL in the results array.
     */
    async function runUrl(urlData, idx) {
      const url = urlData.url;
      const testIds = urlData.testIds;
      console.log(`[${idx + 1}/${urls.length}] ${url}`);
      const t0 = Date.now();

      // Create new pages for desktop and mobile contexts
      const pageD = await desktopCtx.newPage();
      const pageM = await mobileCtx.newPage();
      let respD;

      // Navigate to the URL in the desktop context
      try {
        respD = await pageD.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
      } catch (error) {
        console.log(`Navigation error for ${url}: ${error.message}`);
        // Capture screenshot on navigation error
        const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_');
        const screenshotPath = path.join(screenshotDir, `${safeUrl}-navigation-error.png`);
        await pageD.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot captured on navigation error: ${screenshotPath}`);
      }

      // Navigate to the URL in the mobile context
      try {
        await pageM.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
      } catch (error) {
        console.log(`Mobile navigation error for ${url}: ${error.message}`);
      }

      // Record the HTTP status code from the desktop response
      const httpStatus = respD ? respD.status() : 'N/A';
      results[idx]['HTTP Status'] = httpStatus;

      // Track failed test IDs for this URL
      const failedTestIds = [];

      /* ---------- iterate through every Test ID specified for this URL ---------- */
      for (const id of allTestIds) {
        // Skip tests not specified for this URL
        if (!testIds.includes(id)) continue;

        let pass = false;
        try {
          switch (id) {
            /* ##### Layout sanity checks ########################################*/
            case 'TC-01': { // Desktop hero has an absolutely-positioned child
              await pageD.waitForSelector('section.ge-homepage-hero-v2-component', { timeout: 10000 });
              pass = await pageD.evaluate(() => {
                const hero = document.querySelector('section.ge-homepage-hero-v2-component');
                return hero && [...hero.querySelectorAll('*')]
                       .some(el => getComputedStyle(el).position === 'absolute');
              });
              break;
            }
            case 'TC-02': { // Mobile hero *not* absolutely positioned
              const inline = await pageM.$eval(
                'div[id*="ge-homepage-hero"] div[style]', e => e.getAttribute('style')
              ).catch(() => '');
              pass = !/position\s*:\s*absolute/i.test(inline);
              break;
            }
            case 'TC-03': pass = !!(await pageD.$('header, div[class*="header"]')); break; // Header exists
            case 'TC-04': pass = !!(await pageD.$('nav, div[class*="nav"]')); break;    // Nav exists
            case 'TC-05': pass = !!(await pageD.$('main, div[class*="main"]')); break;  // Main exists
            case 'TC-06': pass = !!(await pageD.$('footer, div[class*="footer"]')); break; // Footer exists

            /* ##### TC-07 – video splash ⇒ Vidyard player #######################*/
            case 'TC-07': {
              await pageD.waitForLoadState('networkidle');
              if (await pageD.$('video, video[data-testid="hls-video"], iframe[src*="vidyard"]')) {
                pass = true;
                break;
              }
              const clickSel = await scrollAndFind(pageD, [
                '.ge-contentTeaser__content-section__contentTeaserHero-play-icon',
                '.eds-rd-play', '.eds-rd-play-icon',
                'div[data-testid="splashScreen"]',
                '.ge-contentTeaser__content-section__contentTeaserHero__img-container'
              ]);
              if (!clickSel) {
                results[idx][id] = 'NA';
                break;
              }
              await jsClick(pageD, clickSel);
              const modal = await pageD.waitForSelector(
                'div.ge-modal-window, div.ge-modal-window-wrapper',
                { timeout: 15000 }
              ).catch(() => null);
              if (!modal) {
                results[idx][id] = 'NA';
                break;
              }
              pass = await pageD.waitForSelector(
                'div.vidyard-player-container, iframe[src*="play.vidyard.com"]',
                { timeout: 15000 }
              ).then(() => true).catch(() => false);
              break;
            }

            /* ##### Interaction / flows #########################################*/
            case 'TC-08': { // "Contact us" button brings up a form
              const before = (await pageD.$$('form')).length;
              await pageD.waitForSelector('button.ge-contact-us-button__contactus-action-button', { timeout: 10000 });
              await pageD.click('button.ge-contact-us-button__contactus-action-button');
              pass = await pageD.waitForFunction(
                prev => document.querySelectorAll('form').length > prev,
                before,
                { timeout: 10000 }
              ).then(() => true).catch(() => false);
              break;
            }

            case 'TC-09': { // Declared Rendering Error (New Test)
              const errorText = 'A rendering error occurred';
              const pageContent = await pageD.content();
              pass = !pageContent.includes(errorText); // Pass if no error text found
              break;
            }

            case 'TC-10': pass = pageD.url().includes('/gatekeeper?'); break; // Gatekeeper

            case 'TC-11': { // Insights first article link works
              await pageD.click('div[class*="insights-list"] a').catch(() => {});
              const r = await pageD.goto(pageD.url()).catch(() => null);
              pass = !!r && r.status() === 200;
              break;
            }

            case 'TC-12': pass = pageD.url().includes('/account/doccheck-login'); break; // DocCheck

            case 'TC-13': { // DE nav-link redirect (301)
              await pageD.click('span.ge-cdx-header-redesign__nav-menu-item__nav-link:has-text("Produkte")');
              await pageD.click('div.menu-content-container-item-data:has-text("Ultraschall")');
              const more = await pageD.waitForSelector('a:has-text("Mehr erfahren")', { timeout: 10000 });
              await Promise.all([pageD.waitForNavigation({ timeout: 10000 }), more.click()]);
              const dest = pageD.url();
              pass = dest.startsWith('https://www.ge-ultraschall.com/') ||
                     dest.startsWith('https://gehealthcare-ultrasound.com/');
              break;
            }

            /* ##### Basic HTTP sanity ###########################################*/
            case 'TC-14': { // Check if HTTP status is 2xx or redirect
              const c = respD ? respD.status() : 0;
              pass = (c >= 200 && c < 300) || HTTP_REDIRECT.includes(c);
              break;
            }

            default:
              results[idx][id] = 'NA';
              continue;
          }
        } catch (err) {
          console.log(`   EXCEPTION ${err.message}`);
          pass = false;
        }

        results[idx][id] = pass ? 'Pass' : 'Fail';

        // If the test failed, add its ID to the list of failed tests for this URL
        if (!pass) {
          failedTestIds.push(id);
        }
      }

      // If there were any failed tests, capture a full-page screenshot
      if (failedTestIds.length > 0) {
        const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize URL for filename
        const screenshotName = `${safeUrl}-failed-${failedTestIds.join(',')}.png`;
        const screenshotPath = path.join(screenshotDir, screenshotName);
        await pageD.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot captured for failed tests (${failedTestIds.join(',')}): ${screenshotPath}`);
      }

      // Compute "Page Pass?" for tests specified in Test IDs
      results[idx]['Page Pass?'] = testIds.length === 0 || testIds.every(id => ['Pass', 'NA'].includes(results[idx][id]))
        ? 'Pass' : 'Fail';

      console.log(`     ✔ ${(Date.now() - t0) / 1000}s`);
      await pageD.close();
      await pageM.close();
    }

    /*──────────────────────────── 7. Run in batches ─────────────────────────────*/
    // Step 7: Run tests in batches for efficiency (e.g., 2 URLs at a time)
    const CONCURRENCY = 2;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const slice = urls.slice(i, i + CONCURRENCY);
      console.log(`\n➡  Batch ${i + 1}-${i + slice.length}`);
      await Promise.all(slice.map((u, j) => runUrl(u, i + j)));
    }

    /*──────────────────────────── 8. Summary + Metadata ─────────────────────────*/
    // Step 8: Summarize results and update metadata
    const total = results.length;
    const passed = results.filter(r => r['Page Pass?'] === 'Pass').length;
    const failed = total - passed;

    console.log(`\n${passed}/${total} pages passed, ${failed} failed.`);
    allTestIds.forEach(id => {
      const f = results.filter(r => r[id] === 'Fail').length;
      if (f) console.log(`  • ${f} × ${id}`);
    });

    // Update Metadata sheet with run details
    const metaHdr = ['Run Date', 'Run Time', 'Initiated By', 'Notes'];
    wb.Sheets.Metadata = XLSX.utils.aoa_to_sheet([
      metaHdr,
      [
        new Date().toISOString().slice(0, 10),   // Run Date
        new Date().toTimeString().slice(0, 8),   // Run Time
        initiatedBy,
        `${passed}/${total} passed`
      ]
    ]);

    /*──────────────────────────── 9. Write Results sheet ────────────────────────*/
    // Step 9: Write the results to the "Results" sheet in the output Excel file
    const ws = wb.Sheets.Results;
    ws['!ref'] = 'A1:A1';                         // Clear old table (keep conditional formatting)
    for (const k in ws) if (!k.startsWith('!')) delete ws[k];

    const headers = ['URL', ...allTestIds, 'Page Pass?', 'HTTP Status'];
    const aoa = [headers, ...results.map(r => headers.map(h => r[h] ?? ''))];
    XLSX.utils.sheet_add_aoa(ws, aoa, { origin: 0 });
    ws['!ref'] = XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: headers.length - 1, r: aoa.length - 1 }
    });

    XLSX.writeFile(wb, outputFile, { bookType: 'xlsx', cellStyles: true });
    console.log(`\n✅ Results saved → ${outputFile}\n`);
    process.exit(0);
  })();
} catch (error) {
  console.error('Fatal error in QA test script:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}