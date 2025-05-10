#!/usr/bin/env node
/*───────────────────────────────────────────────────────────────────────────────
  qa-test.js
  ----------
  • Reads URLs and associated data from input.xlsx using exceljs
  • Runs Playwright checks based on Test IDs per URL
  • Writes results and preserves all input columns (e.g., Region) in output.xlsx
  • Captures screenshots for failed tests with improved timing to avoid blank images
  • Includes TC-09: Declared Rendering Error
  • Outputs success/failure counts as JSON and logs summary for workflow capture
  • Handles cookie banner for gehealthcare.com in TC-08
  • Supports video recording for ad-hoc runs when specified
  • Test definitions in README.md
───────────────────────────────────────────────────────────────────────────────*/

import os from 'os';
import ExcelJS from 'exceljs';
import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

try {
  (async () => {
    /*──────────────────────────── 1. CLI / filenames ─────────────────────────────*/
    console.log('Starting QA test script');
    const [,, inputFile, outputFile, initiatedBy, captureVideo] = process.argv;
    if (!inputFile || !outputFile || !initiatedBy) {
      console.error('Usage: node api/qa-test.js <input.xlsx> <output.xlsx> <Initiated By> [captureVideo]');
      process.exit(1);
    }

    const shouldRecordVideo = captureVideo === 'true';
    console.log(`\n▶ Workbook  : ${inputFile}`);
    console.log(`▶ Output    : ${outputFile}`);
    console.log(`▶ Initiated : ${initiatedBy}`);
    console.log(`▶ Capture Video: ${shouldRecordVideo}\n`);

    /*──────────────────────────── 2. Load URL data dynamically ───────────────────*/
    console.log('Reading URLs and data from Excel file...');
    const inputWorkbook = new ExcelJS.Workbook();
    await inputWorkbook.xlsx.readFile(inputFile);

    const urlSheet = inputWorkbook.getWorksheet('URLs');
    if (!urlSheet) {
      console.error('Sheet "URLs" not found in input.xlsx.');
      process.exit(1);
    }

    // Read header row to identify columns
    const headerRow = urlSheet.getRow(1);
    const headers = headerRow.values.slice(1); // Skip first empty cell
    console.log('Headers:', headers);

    // Find the index of "Test IDs" column (case-insensitive)
    const testIdsIndex = headers.findIndex(h => h && h.toString().toLowerCase() === 'test ids');
    if (testIdsIndex === -1) {
      console.error('Column "Test IDs" not found in URLs sheet.');
      process.exit(1);
    }

    const urlJsonData = [];
    urlSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      const rowData = {};
      headers.forEach((header, index) => {
        rowData[header] = row.getCell(index + 1).value;
      });
      urlJsonData.push(rowData);
    });
    console.log('First 5 rows of URLs sheet:', urlJsonData.slice(0, 5));

    const urls = urlJsonData.map(row => ({
      url: row['URL'],
      testIds: (row[headers[testIdsIndex]] || '').split(',').map(id => id.trim()).filter(Boolean),
      data: row // Store all column data
    }));
    console.log('Extracted URLs with Test IDs and data:', urls);

    if (!urls.length) {
      console.error('No URLs found.');
      process.exit(1);
    }

    const allTestIds = [
      'TC-01', 'TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06', 'TC-07', 'TC-08',
      'TC-09', 'TC-10', 'TC-11', 'TC-12', 'TC-13', 'TC-14'
    ];

    /*──────────────────────────── 3. Seed results with all columns ───────────────*/
    const results = urls.map(u => {
      const row = { ...u.data }; // Include all input columns (e.g., Region)
      allTestIds.forEach(id => (row[id] = 'NA'));
      row['HTTP Status'] = '-';
      row['Page Pass?'] = 'Not Run';
      return row;
    });

    /*──────────────────────────── 4. Playwright setup ───────────────────────────*/
    const screenshotDir = 'screenshots';
    const videoDir = 'videos';
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);
    if (shouldRecordVideo && !fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    const browser = await chromium.launch();
    const contextOptions = shouldRecordVideo ? { recordVideo: { dir: videoDir } } : {};
    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...contextOptions });
    const mobileCtx = await browser.newContext({ ...devices['Pixel 5'], ...contextOptions });

    /*──────────────────────────── 5. Helpers ─────────────────────────────────────*/
    const HTTP_REDIRECT = [301, 302];

    async function scrollAndFind(page, selectors, maxScreens = 10) {
      const viewH = await page.evaluate(() => window.innerHeight);
      for (let pass = 0; pass < maxScreens; pass++) {
        for (const sel of selectors)
          if (await page.$(sel)) return sel;
        await page.evaluate(vh => window.scrollBy(0, vh), viewH);
        await page.waitForTimeout(500);
      }
      return null;
    }

    async function jsClick(page, selector) {
      return page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }, selector);
    }

    async function dismissCookieBanner(page, url) {
      if (url.includes('gehealthcare.com')) {
        try {
          await page.waitForSelector('#_evidon-decline-button', { timeout: 5000 });
          await page.click('#_evidon-decline-button');
          console.log('Cookie banner dismissed for', url);
          await page.waitForTimeout(1000); // Wait for banner to disappear
        } catch (error) {
          console.log(`No cookie banner found or error dismissing for ${url}: ${error.message}`);
        }
      }
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

      try {
        respD = await pageD.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
        console.log(`Page loaded for ${url}, status: ${respD.status()}`);
      } catch (error) {
        console.log(`Navigation error for ${url}: ${error.message}`);
        const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_');
        await pageD.screenshot({ path: `${screenshotDir}/${safeUrl}-nav-error.png`, fullPage: true })
          .catch(err => console.error(`Screenshot failed: ${err.message}`));
      }

      try {
        await pageM.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
      } catch (error) {
        console.log(`Mobile navigation error for ${url}: ${error.message}`);
      }

      results[idx]['HTTP Status'] = respD ? respD.status() : 'N/A';
      const failedTestIds = [];

      const validTestIds = testIds.filter(id => allTestIds.includes(id));
      if (testIds.length !== validTestIds.length) {
        console.log(`   Warning: Invalid test IDs [${testIds.filter(id => !allTestIds.includes(id)).join(', ')}] ignored.`);
      }

      for (const id of allTestIds) {
        if (!validTestIds.includes(id)) continue;

        let pass = false;
        try {
          switch (id) {
            case 'TC-01': {
              await pageD.waitForSelector('section.ge-homepage-hero-v2-component', { timeout: 10000 });
              pass = await pageD.evaluate(() => {
                const hero = document.querySelector('section.ge-homepage-hero-v2-component');
                return hero && [...hero.querySelectorAll('*')].some(el => getComputedStyle(el).position === 'absolute');
              });
              break;
            }
            case 'TC-02': {
              const inline = await pageM.$eval('div[id*="ge-homepage-hero"] div[style]', e => e.getAttribute('style')).catch(() => '');
              pass = !/position\s*:\s*absolute/i.test(inline);
              break;
            }
            case 'TC-03': pass = !!(await pageD.$('header, div[class*="header"]')); break;
            case 'TC-04': pass = !!(await pageD.$('nav, div[class*="nav"]')); break;
            case 'TC-05': pass = !!(await pageD.$('main, div[class*="main"]')); break;
            case 'TC-06': pass = !!(await pageD.$('footer, div[class*="footer"]')); break;
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
              if (!clickSel) { results[idx][id] = 'NA'; break; }
              await jsClick(pageD, clickSel);
              const modal = await pageD.waitForSelector('div.ge-modal-window, div.ge-modal-window-wrapper', { timeout: 15000 }).catch(() => null);
              if (!modal) { results[idx][id] = 'NA'; break; }
              pass = await pageD.waitForSelector('div.vidyard-player-container, iframe[src*="play.vidyard.com"]', { timeout: 15000 }).then(() => true).catch(() => false);
              break;
            }
            case 'TC-08': {
              await dismissCookieBanner(pageD, url); // Dismiss cookie banner before TC-08
              const before = (await pageD.$$('form')).length;
              await pageD.waitForSelector('button.ge-contact-us-button__contactus-action-button', { timeout: 10000 });
              await pageD.click('button.ge-contact-us-button__contactus-action-button');
              pass = await pageD.waitForFunction(prev => document.querySelectorAll('form').length > prev, before, { timeout: 10000 }).then(() => true).catch(() => false);
              break;
            }
            case 'TC-09': {
              const errorText = 'A rendering error occurred';
              pass = !(await pageD.content()).includes(errorText);
              break;
            }
            case 'TC-10': pass = pageD.url().includes('/gatekeeper?'); break;
            case 'TC-11': {
              await pageD.click('div[class*="insights-list"] a').catch(() => {});
              const r = await pageD.goto(pageD.url()).catch(() => null);
              pass = !!r && r.status() === 200;
              break;
            }
            case 'TC-12': pass = pageD.url().includes('/account/doccheck-login'); break;
            case 'TC-13': {
              await pageD.click('span.ge-cdx-header-redesign__nav-menu-item__nav-link:has-text("Produkte")');
              await pageD.click('div.menu-content-container-item-data:has-text("Ultraschall")');
              const more = await pageD.waitForSelector('a:has-text("Mehr erfahren")', { timeout: 10000 });
              await Promise.all([pageD.waitForNavigation({ timeout: 10000 }), more.click()]);
              const dest = pageD.url();
              pass = dest.startsWith('https://www.ge-ultraschall.com/') || dest.startsWith('https://gehealthcare-ultrasound.com/');
              break;
            }
            case 'TC-14': {
              const c = respD ? respD.status() : 0;
              pass = (c >= 200 && c < 300) || HTTP_REDIRECT.includes(c);
              break;
            }
          }
        } catch (err) {
          console.log(`   EXCEPTION ${err.message}`);
          pass = false;
        }

        results[idx][id] = pass ? 'Pass' : 'Fail';
        if (!pass) failedTestIds.push(id);
      }

      // Capture screenshot for failed tests after all tests run
      if (failedTestIds.length > 0) {
        try {
          // Wait for full page load and rendering
          await pageD.waitForLoadState('networkidle', { timeout: 30000 });
          await pageD.waitForTimeout(1000); // Additional delay for rendering
          const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_');
          const screenshotPath = `${screenshotDir}/${safeUrl}-failed-${failedTestIds.join(',')}.png`;
          console.log(`Capturing screenshot: ${screenshotPath}`);
          await pageD.screenshot({ path: screenshotPath, fullPage: true });
        } catch (error) {
          console.error(`Failed to capture screenshot for ${url}: ${error.message}`);
        }
      }

      results[idx]['Page Pass?'] = validTestIds.length === 0 || validTestIds.every(id => ['Pass', 'NA'].includes(results[idx][id])) ? 'Pass' : 'Fail';

      // Save video path if recording
      if (shouldRecordVideo) {
        const video = await pageD.video();
        if (video) {
          const videoPath = await video.path();
          const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_');
          const newVideoPath = path.join(videoDir, `${safeUrl}-${idx + 1}.webm`);
          fs.renameSync(videoPath, newVideoPath);
          console.log(`Video saved: ${newVideoPath}`);
        }
      }

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

    /*──────────────────────────── 8. Summary ────────────────────────────────────*/
    const total = results.length;
    const passed = results.filter(r => r['Page Pass?'] === 'Pass').length;
    const failed = total - passed;
    const failedUrls = results
      .filter(r => r['Page Pass?'] === 'Fail')
      .map(r => ({
        url: r['URL'],
        failedTests: allTestIds.filter(id => r[id] === 'Fail')
      }));

    console.log(`\n${passed}/${total} pages passed, ${failed} failed.`);
    allTestIds.forEach(id => {
      const f = results.filter(r => r[id] === 'Fail').length;
      if (f) console.log(`  • ${f} × ${id}`);
    });

    /*──────────────────────────── 9. Write new workbook ─────────────────────────*/
    const outputWorkbook = new ExcelJS.Workbook();

    // Results sheet with all columns
    const resultSheet = outputWorkbook.addWorksheet('Results');
    const resultHeaders = [...headers, ...allTestIds, 'Page Pass?', 'HTTP Status'];
    resultSheet.getRow(1).values = resultHeaders;
    results.forEach((result, index) => {
      const rowData = headers.map(h => result[h]);
      const testResults = allTestIds.map(id => result[id]);
      resultSheet.getRow(index + 2).values = [...rowData, ...testResults, result['Page Pass?'], result['HTTP Status']];
    });

    // Metadata sheet
    const metaSheet = outputWorkbook.addWorksheet('Metadata');
    metaSheet.getRow(1).values = ['Run Date', 'Run Time', 'Initiated By', 'Notes'];
    metaSheet.getRow(2).values = [
      new Date().toISOString().slice(0, 10),
      new Date().toTimeString().slice(0, 8),
      initiatedBy,
      `${passed}/${total} passed`
    ];

    await outputWorkbook.xlsx.writeFile(outputFile);
    console.log(`\n✅ Results saved → ${outputFile}\n`);

    // Summary JSON for Dashboarding
    const summary = { 
      passed, 
      failed, 
      na: results.filter(r => r['Page Pass?'] === 'Not Run').length,
      total,
      failed_urls: failedUrls.map(f => f.url),
      failed_tests: failedUrls.map(f => f.failedTests).flat()
    };
    fs.writeFileSync('summary.json', JSON.stringify(summary));
    console.log('Summary:', JSON.stringify(summary)); // Log summary for workflow capture

    process.exit(0);
  })();
} catch (error) {
  console.error('Fatal error:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}