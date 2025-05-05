#!/usr/bin/env node
/*───────────────────────────────────────────────────────────────────────────────
  qa-test.js
  ----------
  • Reads workbook (URLs / empty Results + Metadata)
  • Runs Playwright checks (desktop + mobile) based on Test IDs specified per URL
  • Writes Pass/Fail matrix and fills Metadata
  • Captures screenshots for failed tests
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
    // Check if the file looks like JSON (indicating an API error)
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

    // Check for required sheets
    const requiredSheets = ['URLs', 'Metadata', 'Results'];
    for (const sheet of requiredSheets) {
      if (!wb.SheetNames.includes(sheet)) {
        console.error(`Required sheet "${sheet}" not found. Available sheets:`, wb.SheetNames);
        process.exit(1);
      }
    }

    // Convert "URLs" sheet to JSON
    const urlSheet = wb.Sheets['URLs'];
    const urlJsonData = XLSX.utils.sheet_to_json(urlSheet);
    console.log('First 5 rows of URLs sheet:', urlJsonData.slice(0, 5)); // Debug: Log first 5 rows

    // Extract URLs and their test IDs
    const urls = urlJsonData.map(row => ({
      url: row['URL'],
      testIds: (row['Test IDs'] || '').split(',').map(id => id.trim()).filter(Boolean)
    }));
    console.log('Extracted URLs with Test IDs:', urls); // Debug: Log the extracted URLs and test IDs

    if (!urls.length) {
      console.error('No URLs found.');
      process.exit(1);
    }

    // Define all possible test IDs (as per README)
    const allTestIds = [
      'TC-01', 'TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06',
      'TC-07', 'TC-08', 'TC-09', 'TC-10', 'TC-11', 'TC-12', 'TC-13'
    ];

    /*──────────────────────────── 3. Seed empty results ─────────────────────────*/
    const results = urls.map(u => {
      const row = { URL: u.url };
      allTestIds.forEach(id => (row[id] = 'NA')); // Initialize all test results as NA
      row['HTTP Status'] = '-'; // Column for HTTP status
      row['Page Pass?'] = 'Not Run';
      return row;
    });

    /*──────────────────────────── 4. Playwright contexts ─────────────────────────*/
    // Create screenshots directory if it doesn't exist
    const screenshotDir = 'screenshots';
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir);
    }

    const browser = await chromium.launch();
    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const mobileCtx = await browser.newContext(devices['Pixel 5']);

    /*──────────────────────────── 5. Helpers ─────────────────────────────────────*/
    const HTTP_REDIRECT = [301, 302]; // redirects we'll count as "OK"

    /** Scroll page one viewport at a time until any selector becomes visible. */
    async function scrollAndFind(page, selectors, maxScreens = 10) {
      const viewH = await page.evaluate(() => window.innerHeight);
      for (let pass = 0; pass < maxScreens; pass++) {
        for (const sel of selectors)
          if (await page.$(sel)) return sel; // first match wins
        await page.evaluate(vh => window.scrollBy(0, vh), viewH);
        await page.waitForTimeout(500); // allow lazy content
      }
      return null;
    }

    /** JS-level click (works even if Playwright thinks element is off-screen). */
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
    async function runUrl(urlData, idx) {
      const url = urlData.url;
      const testIds = urlData.testIds;
      console.log(`[${idx + 1}/${urls.length}] ${url}`);
      const t0 = Date.now();

      const pageD = await desktopCtx.newPage();
      const pageM = await mobileCtx.newPage();
      let respD;

      // Navigate to the URL
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

      try {
        await pageM.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
      } catch (error) {
        console.log(`Mobile navigation error for ${url}: ${error.message}`);
      }

      // Record HTTP status
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
            case 'TC-01': { // desktop hero has an absolutely-positioned child
              await pageD.waitForSelector('section.ge-homepage-hero-v2-component',
                                          { timeout: 10000 });
              pass = await pageD.evaluate(() => {
                const hero = document.querySelector('section.ge-homepage-hero-v2-component');
                return hero && [...hero.querySelectorAll('*')]
                       .some(el => getComputedStyle(el).position === 'absolute');
              });
              break;
            }
            case 'TC-02': { // mobile hero *not* absolutely positioned
              const inline = await pageM.$eval(
                'div[id*="ge-homepage-hero"] div[style]', e => e.getAttribute('style')
              ).catch(() => '');
              pass = !/position\s*:\s*absolute/i.test(inline);
              break;
            }
            case 'TC-03': pass = !!(await pageD.$('header, div[class*="header"]')); break; // header
            case 'TC-04': pass = !!(await pageD.$('nav,    div[class*="nav"]'));    break; // nav
            case 'TC-05': pass = !!(await pageD.$('main,   div[class*="main"]'));   break; // main
            case 'TC-06': pass = !!(await pageD.$('footer, div[class*="footer"]')); break; // footer

            /* ##### TC-07 – video splash ⇒ Vidyard player #######################*/
            case 'TC-07': {
              await pageD.waitForLoadState('networkidle');

              // (a) already have a <video> or Vidyard iframe?
              if (await pageD.$('video, video[data-testid="hls-video"], iframe[src*="vidyard"]')) {
                pass = true; break;
              }

              // (b) scroll to find a clickable splash / play icon / hero image
              const clickSel = await scrollAndFind(pageD, [
                '.ge-contentTeaser__content-section__contentTeaserHero-play-icon',
                '.eds-rd-play', '.eds-rd-play-icon',
                'div[data-testid="splashScreen"]',
                '.ge-contentTeaser__content-section__contentTeaserHero__img-container'
              ]);

              if (!clickSel) { results[idx][id] = 'NA'; break; }

              await jsClick(pageD, clickSel);

              // (c) wait for modal wrapper, then Vidyard iframe
              const modal = await pageD.waitForSelector(
                              'div.ge-modal-window, div.ge-modal-window-wrapper',
                              { timeout: 15000 }).catch(() => null);
              if (!modal) { results[idx][id] = 'NA'; break; }

              pass = await pageD.waitForSelector(
                       'div.vidyard-player-container, iframe[src*="play.vidyard.com"]',
                       { timeout: 15000 }).then(() => true).catch(() => false);
              break;
            }

            /* ##### Interaction / flows #########################################*/
            case 'TC-08': { // "Contact us" button brings up a form
              const before = (await pageD.$$('form')).length;
              await pageD.waitForSelector('button.ge-contact-us-button__contactus-action-button',
                                          { timeout: 10000 });
              await pageD.click('button.ge-contact-us-button__contactus-action-button');
              pass = await pageD.waitForFunction(
                       prev => document.querySelectorAll('form').length > prev,
                       before, { timeout: 10000 }
                     ).then(() => true).catch(() => false);
              break;
            }
            case 'TC-09': pass = pageD.url().includes('/gatekeeper?'); break;     // Gatekeeper
            case 'TC-10': {                                                    // Insights 200
              await pageD.click('div[class*="insights-list"] a').catch(() => {});
              const r = await pageD.goto(pageD.url()).catch(() => null);
              pass = !!r && r.status() === 200;
              break;
            }
            case 'TC-11': pass = pageD.url().includes('/account/doccheck-login'); break; // DocCheck
            case 'TC-12': {                                                    // deep nav flow
              await pageD.click('span.ge-cdx-header-redesign__nav-menu-item__nav-link:has-text("Produkte")');
              await pageD.click('div.menu-content-container-item-data:has-text("Ultraschall")');
              const more = await pageD.waitForSelector('a:has-text("Mehr erfahren")',
                                                       { timeout: 10000 });
              await Promise.all([pageD.waitForNavigation({ timeout: 10000 }), more.click()]);
              const dest = pageD.url();
              pass = dest.startsWith('https://www.ge-ultraschall.com/') ||
                     dest.startsWith('https://gehealthcare-ultrasound.com/');
              break;
            }

            /* ##### Basic HTTP sanity ###########################################*/
            case 'TC-13': {                                                      // Check if HTTP status is 2xx (success) or 301/302 (redirect)
              const c = respD ? respD.status() : 0;
              pass = (c >= 200 && c < 300) || HTTP_REDIRECT.includes(c);
              break;
            }

            default: results[idx][id] = 'NA'; continue;  // tests if NA for label
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
    const CONCURRENCY = 2;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const slice = urls.slice(i, i + CONCURRENCY);
      console.log(`\n➡  Batch ${i + 1}-${i + slice.length}`);
      await Promise.all(slice.map((u, j) => runUrl(u, i + j)));
    }

    /*──────────────────────────── 8. Summary + Metadata ─────────────────────────*/
    const total = results.length;
    const passed = results.filter(r => r['Page Pass?'] === 'Pass').length;
    const failed = total - passed;

    console.log(`\n${passed}/${total} pages passed, ${failed} failed.`);
    allTestIds.forEach(id => {
      const f = results.filter(r => r[id] === 'Fail').length;
      if (f) console.log(`  • ${f} × ${id}`);
    });

    /* Metadata row (row 2) */
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
    const ws = wb.Sheets.Results;
    ws['!ref'] = 'A1:A1';                         // clear old table (keep CF)
    for (const k in ws) if (!k.startsWith('!')) delete ws[k];

    const headers = ['URL', ...allTestIds, 'Page Pass?', 'HTTP Status'];
    const aoa = [headers, ...results.map(r => headers.map(h => r[h] ?? ''))];
    XLSX.utils.sheet_add_aoa(ws, aoa, { origin: 0 });
    ws['!ref'] = XLSX.utils.encode_range({
      s: { c: 0,                 r: 0 },
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