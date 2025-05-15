#!/usr/bin/env node
/*───────────────────────────────────────────────────────────────────────────────
  qa-test.js
  ----------
  • Reads URLs and data from input.xlsx using exceljs
  • Runs Playwright checks based on Test IDs per URL
  • Stores results in Supabase (test_runs, test_results, crawl_progress)
  • Uploads screenshots/videos to Vercel Blob for failed tests
  • Tracks real-time crawl progress with estimated completion
  • Preserves Excel output for compatibility
  • Sends standardized payload to /api/store-run
  • Test definitions in README.md
───────────────────────────────────────────────────────────────────────────────*/

import os from 'os';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { put } from '@vercel/blob';
import fetch from 'node-fetch';

require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

try {
  (async () => {
    console.log('Starting QA test script');
    const [,, inputFile, outputFile, initiatedBy] = process.argv;
    const captureVideo = process.argv[4] === 'true';
    if (!inputFile || !outputFile || !initiatedBy) {
      console.error('Usage: node api/qa-test.js <input.xlsx> <output.xlsx> <Initiated By> [captureVideo]');
      process.exit(1);
    }

    console.log(`\n▶ Workbook  : ${inputFile}`);
    console.log(`▶ Output    : ${outputFile}`);
    console.log(`▶ Initiated : ${initiatedBy}`);
    console.log(`▶ Capture Video: ${captureVideo}\n`);

    console.log('Reading URLs and data from Excel file...');
    const inputWorkbook = new ExcelJS.Workbook();
    await inputWorkbook.xlsx.readFile(inputFile);

    const urlSheet = inputWorkbook.getWorksheet('URLs');
    if (!urlSheet) {
      console.error('Sheet "URLs" not found in input.xlsx.');
      process.exit(1);
    }

    const headerRow = urlSheet.getRow(1);
    const headers = headerRow.values.slice(1);
    console.log('Headers:', headers);

    const testIdsIndex = headers.findIndex(h => h && h.toString().toLowerCase() === 'test ids');
    if (testIdsIndex === -1) {
      console.error('Column "Test IDs" not found in URLs sheet.');
      process.exit(1);
    }

    const urlJsonData = [];
    urlSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
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
      data: row
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

    const results = urls.map(u => {
      const row = { ...u.data };
      allTestIds.forEach(id => (row[id] = 'NA'));
      row['HTTP Status'] = '-';
      row['Page Pass?'] = 'Not Run';
      return row;
    });

    const runId = `run-${Date.now()}`;
    const { error: testRunError } = await supabase
      .from('test_runs')
      .insert({
        run_id: runId,
        initiated_by: initiatedBy,
        note: 'QA test run initiated via GitHub Actions'
      });
    if (testRunError) {
      console.error('Error creating test run:', testRunError);
      process.exit(1);
    }

    const totalUrls = urls.length;
    const startTime = new Date().toISOString();
    const { error: progressError } = await supabase
      .from('crawl_progress')
      .insert({
        run_id: runId,
        total_urls: totalUrls,
        urls_completed: 0,
        started_at: startTime,
        status: 'running',
        status_summary: 'Your test has started.'
      });
    if (progressError) {
      console.error('Error creating crawl progress:', progressError);
      process.exit(1);
    }

    const screenshotDir = 'screenshots';
    const videoDir = 'videos';
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      recordVideo: { dir: videoDir }
    });

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

    async function uploadFile(filePath, fileName) {
      const fileBuffer = fs.readFileSync(filePath);
      const blob = await put(fileName, fileBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return blob.url;
    }

    async function updateProgress(completed, startTime) {
      const now = new Date();
      const elapsedMs = now - new Date(startTime);
      const urlsPerMs = completed / elapsedMs;
      const remainingUrls = totalUrls - completed;
      const estimatedMsLeft = remainingUrls / urlsPerMs;
      const estimatedDone = new Date(now.getTime() + estimatedMsLeft).toISOString();

      const percentage = Math.round((completed / totalUrls) * 100);
      const minutesLeft = Math.ceil(estimatedMsLeft / 60000);
      const statusSummary = `Your test is ${percentage}% done. Estimated time left: ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`;

      const { error } = await supabase
        .from('crawl_progress')
        .update({
          urls_completed: completed,
          estimated_done: estimatedDone,
          status_summary: statusSummary
        })
        .eq('run_id', runId);

      if (error) {
        console.error('Error updating crawl progress:', error);
      }
    }

    async function insertTestResult(url, region, testId, result, errorDetails, screenshotPath, videoPath) {
      const { error } = await supabase
        .from('test_results')
        .insert({
          run_id: runId,
          url,
          region_code: region,
          test_id: testId,
          result,
          error_details: errorDetails,
          screenshot_path: screenshotPath,
          video_path: videoPath
        });
      if (error) {
        console.error('Error inserting test result:', error);
      }
    }

    async function runUrl(urlData, idx) {
      const url = urlData.url;
      const testIds = urlData.testIds;
      const region = urlData.data['Region'] || 'N/A';
      console.log(`[${idx + 1}/${urls.length}] ${url}`);
      const t0 = Date.now();

      const page = await context.newPage();
      let resp;

      try {
        resp = await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
        console.log(`Page loaded for ${url}, status: ${resp.status()}`);
      } catch (error) {
        console.log(`Navigation error for ${url}: ${error.message}`);
        const safeUrl = url.replace(/[^a-zA-Z0.9]/g, '_');
        await page.screenshot({ path: `${screenshotDir}/${safeUrl}-nav-error.png`, fullPage: true })
          .catch(err => console.error(`Screenshot failed: ${err.message}`));
      }

      results[idx]['HTTP Status'] = resp ? resp.status() : 'N/A';
      const failedTestIds = [];

      const validTestIds = testIds.filter(id => allTestIds.includes(id));
      if (testIds.length !== validTestIds.length) {
        console.log(`   Warning: Invalid test IDs [${testIds.filter(id => !allTestIds.includes(id)).join(', ')}] ignored.`);
      }

      for (const id of allTestIds) {
        if (!validTestIds.includes(id)) continue;

        let pass = false;
        let errorDetails = '';
        try {
          switch (id) {
            case 'TC-01': {
              await page.waitForSelector('section.ge-homepage-hero-v2-component', { timeout: 10000 });
              pass = await page.evaluate(() => {
                const hero = document.querySelector('section.ge-homepage-hero-v2-component');
                return hero && [...hero.querySelectorAll('*')].some(el => getComputedStyle(el).position === 'absolute');
              });
              break;
            }
            case 'TC-02': {
              const inline = await page.$eval('div[id*="ge-homepage-hero"] div[style]', e => e.getAttribute('style')).catch(() => '');
              pass = !/position\s*:\s*absolute/i.test(inline);
              break;
            }
            case 'TC-03': {
              await page.waitForSelector('header, div[class*="header"]', { timeout: 30000 });
              pass = !!(await page.$('header, div[class*="header"]'));
              break;
            }
            case 'TC-04': {
              await page.waitForSelector('nav, div[class*="nav"]', { timeout: 30000 });
              pass = !!(await page.$('nav, div[class*="nav"]'));
              break;
            }
            case 'TC-05': {
              await page.waitForSelector('main, div[class*="main"]', { timeout: 30000 });
              pass = !!(await page.$('main, div[class*="main"]'));
              break;
            }
            case 'TC-06': {
              await page.waitForSelector('footer, div[class*="footer"]', { timeout: 30000 });
              pass = !!(await page.$('footer, div[class*="footer"]'));
              break;
            }
            case 'TC-07': {
              await page.waitForLoadState('networkidle');
              if (await page.$('video, video[data-testid="hls-video"], iframe[src*="vidyard"]')) {
                pass = true;
                break;
              }
              const clickSel = await scrollAndFind(page, [
                '.ge-contentTeaser__content-section__contentTeaserHero-play-icon',
                '.eds-rd-play', '.eds-rd-play-icon',
                'div[data-testid="splashScreen"]',
                '.ge-contentTeaser__content-section__contentTeaserHero__img-container'
              ]);
              if (!clickSel) { results[idx][id] = 'NA'; break; }
              await jsClick(page, clickSel);
              const modal = await page.waitForSelector('div.ge-modal-window, div.ge-modal-window-wrapper', { timeout: 15000 }).catch(() => null);
              if (!modal) { results[idx][id] = 'NA'; break; }
              pass = await page.waitForSelector('div.vidyard-player-container, iframe[src*="play.vidyard.com"]', { timeout: 15000 }).then(() => true).catch(() => false);
              break;
            }
            case 'TC-08': {
              const cookieBanner = await page.$('#_evidon_banner');
              if (cookieBanner) {
                const declineButton = await page.$('#_evidon-decline-button');
                if (declineButton) {
                  await declineButton.click();
                  await page.waitForTimeout(1000);
                }
              }
              const before = (await page.$$('form')).length;
              await page.waitForSelector('button.ge-contact-us-button__contactus-action-button', { timeout: 10000 });
              await page.click('button.ge-contact-us-button__contactus-action-button');
              pass = await page.waitForFunction(prev => document.querySelectorAll('form').length > prev, before, { timeout: 10000 }).then(() => true).catch(() => false);
              break;
            }
            case 'TC-09': {
              const errorText = 'A rendering error occurred';
              pass = !(await page.content()).includes(errorText);
              break;
            }
            case 'TC-10': pass = page.url().includes('/gatekeeper?'); break;
            case 'TC-11': {
              await page.click('div[class*="insights-list"] a').catch(() => {});
              const r = await page.goto(page.url()).catch(() => null);
              pass = !!r && r.status() === 200;
              break;
            }
            case 'TC-12': pass = page.url().includes('/account/doccheck-login'); break;
            case 'TC-13': {
              await page.click('span.ge-cdx-header-redesign__nav-menu-item__nav-link:has-text("Produkte")');
              await page.click('div.menu-content-container-item-data:has-text("Ultraschall")');
              const more = await page.waitForSelector('a:has-text("Mehr erfahren")', { timeout: 10000 });
              await Promise.all([page.waitForNavigation({ timeout: 10000 }), more.click()]);
              const dest = page.url();
              pass = dest.startsWith('https://www.ge-ultraschall.com/') || dest.startsWith('https://gehealthcare-ultrasound.com/');
              break;
            }
            case 'TC-14': {
              const c = resp ? resp.status() : 0;
              pass = (c >= 200 && c < 300) || HTTP_REDIRECT.includes(c);
              break;
            }
          }
        } catch (err) {
          console.log(`   EXCEPTION ${err.message}`);
          pass = false;
          errorDetails = err.message;
        }

        results[idx][id] = pass ? 'Pass' : 'Fail';
        const result = pass ? 'pass' : 'fail';
        await insertTestResult(url, region, id, result, errorDetails, null, null);
        if (!pass) failedTestIds.push(id);
      }

      let screenshotUrl = null;
      let videoUrl = null;
      if (failedTestIds.length > 0 || captureVideo) {
        try {
          await page.waitForLoadState('networkidle', { timeout: 30000 });
          await page.waitForTimeout(1000);
          const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_');
          if (failedTestIds.length > 0) {
            const screenshotPath = `${screenshotDir}/${safeUrl}-failed-${failedTestIds.join(',')}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            screenshotUrl = await uploadFile(screenshotPath, `screenshots/${path.basename(screenshotPath)}`);
            console.log(`Screenshot uploaded: ${screenshotUrl}`);
          }
          const video = await page.video();
          if (video) {
            const videoPath = await video.path();
            const newVideoPath = path.join(videoDir, `${safeUrl}-${idx + 1}.webm`);
            fs.renameSync(videoPath, newVideoPath);
            videoUrl = await uploadFile(newVideoPath, `videos/${path.basename(newVideoPath)}`);
            console.log(`Video uploaded: ${videoUrl}`);
          }
        } catch (error) {
          console.error(`Failed to capture/upload media for ${url}: ${error.message}`);
        }
      } else {
        const video = await page.video();
        if (video) {
          const videoPath = await video.path();
          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
            console.log(`Video deleted for passing URL: ${url}`);
          }
        }
      }

      if (screenshotUrl || videoUrl) {
        await supabase
          .from('test_results')
          .update({ screenshot_path: screenshotUrl, video_path: videoUrl })
          .eq('run_id', runId)
          .eq('url', url)
          .in('result', ['fail']);
      }

      results[idx]['Page Pass?'] = validTestIds.length === 0 || validTestIds.every(id => ['Pass', 'NA'].includes(results[idx][id])) ? 'Pass' : 'Fail';

      await updateProgress(idx + 1, startTime);
      console.log(`     ✔ ${(Date.now() - t0) / 1000}s`);
      await page.close();
    }

    const CONCURRENCY = 2;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const slice = urls.slice(i, i + CONCURRENCY);
      console.log(`\n➡  Batch ${i + 1}-${i + slice.length}`);
      await Promise.all(slice.map((u, j) => runUrl(u, i + j)));
    }

    await supabase
      .from('crawl_progress')
      .update({
        status: 'completed',
        estimated_done: new Date().toISOString(),
        status_summary: 'Your test is complete.'
      })
      .eq('run_id', runId);

    const total = results.length;
    const passed = results.filter(r => r['Page Pass?'] === 'Pass').length;
    const failed = total - passed;
    const na = results.filter(r => r['Page Pass?'] === 'Not Run').length;

    console.log(`\n${passed}/${total} pages passed, ${failed} failed, ${na} N/A.`);
    allTestIds.forEach(id => {
      const f = results.filter(r => r[id] === 'Fail').length;
      if (f) console.log(`  • ${f} × ${id}`);
    });

    const failedUrls = [];
    const failedTests = {};
    for (const result of results) {
      const failedTestIds = allTestIds.filter(id => result[id] === 'Fail');
      if (failedTestIds.length > 0) {
        failedUrls.push({ url: result['URL'], failedTests: failedTestIds });
        failedTestIds.forEach(id => {
          failedTests[id] = (failedTests[id] || 0) + 1;
        });
      }
    }

    // Construct and send payload to /api/store-run
    const payload = {
      runId: runId,
      crawlName: 'QA Run',
      date: new Date().toISOString(),
      successCount: passed,
      failureCount: failed,
      initiator: initiatedBy,
    };

    const storeRunUrl = `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/store-run`;
    const response = await fetch(storeRunUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Failed to store run: ${response.statusText}`);
    } else {
      console.log('Successfully stored run in Vercel KV');
    }

    const outputWorkbook = new ExcelJS.Workbook();

    const resultSheet = outputWorkbook.addWorksheet('Results');
    const resultHeaders = [...headers, ...allTestIds, 'Page Pass?', 'HTTP Status'];
    resultSheet.getRow(1).values = resultHeaders;
    results.forEach((result, index) => {
      const rowData = headers.map(h => result[h]);
      const testResults = allTestIds.map(id => result[id]);
      resultSheet.getRow(index + 2).values = [...rowData, ...testResults, result['Page Pass?'], result['HTTP Status']];
    });

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

    const summary = { 
      passed, 
      failed, 
      na,
      total,
      failed_urls: failedUrls,
      failed_tests: failedTests,
      initiator: initiatedBy
    };
    fs.writeFileSync('summary.json', JSON.stringify(summary));
    console.log('Summary:', JSON.stringify(summary));

    process.exit(0);
  })();
} catch (error) {
  console.error('Fatal error:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}