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
  • Implements batching with concurrency limits and delays to avoid 403 errors
  • Enhanced with global timeouts, detailed logging, and dynamic overlay handling
  • Optimized for performance while preserving visual integrity
  • Includes detailed commentary explaining each function and test case logic
  • Updated TC-07 to scroll play button into view and use broader hover target
  • Updated TC-08 with refined Contact Us button selector targeting hero section
  • Updated TC-13 with simplified submenu wait condition for Ultraschall link
  • Added survey handling mechanisms to block and dismiss survey pop-ups
──────────────────────────────────────────────────────────────────────────────*/

import os from 'os';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { put } from '@vercel/blob';
import fetch from 'node-fetch';
import pTimeout from 'p-timeout';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables from .env file
import 'dotenv/config';

// Handle uncaught errors to prevent silent failures
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Initialize Supabase client for storing test results
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Main execution wrapped in an IIFE for async handling
(async () => {
  try {
    console.log('Starting QA test script');
    const [,, inputFile, outputFile, initiatedBy] = process.argv;
    const captureVideo = process.argv[5] ? process.argv[5].toLowerCase() === 'true' : false;

    // Validate command-line arguments
    if (!inputFile || !outputFile || !initiatedBy) {
      console.error('Usage: node api/qa-test.js <input.xlsx> <output.xlsx> <Initiated By> [captureVideo=false]');
      process.exit(1);
    }

    console.log(`\n▶ Workbook  : ${inputFile}`);
    console.log(`▶ Output    : ${outputFile}`);
    console.log(`▶ Initiated : ${initiatedBy}`);
    console.log(`▶ Capture Video: ${captureVideo}\n`);

    // Read Excel input file containing URLs and test data
    console.log('Reading URLs and data from Excel file...');
    const inputWorkbook = new ExcelJS.Workbook();
    await inputWorkbook.xlsx.readFile(inputFile);

    const urlSheet = inputWorkbook.getWorksheet('URLs');
    if (!urlSheet) {
      console.error('Sheet "URLs" not found in input.xlsx.');
      process.exit(1);
    }

    const headerRow = urlSheet.getRow(1);
    const headers = headerRow.values.map(h => h ? h.toString().trim().toLowerCase() : '').filter(Boolean);
    console.log('Headers detected:', headers);

    const urlIndex = headers.indexOf('url');
    const testIdsIndex = headers.indexOf('test ids');
    const regionIndex = headers.indexOf('region');

    if (urlIndex === -1 || testIdsIndex === -1) {
      console.error('Required columns "URL" or "Test IDs" not found in URLs sheet.');
      process.exit(1);
    }

    // Parse URL data from Excel into a structured format
    const urlJsonData = [];
    urlSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row
      const rowData = {};
      headers.forEach((header, index) => {
        const cellValue = row.getCell(index + 1).value;
        rowData[header] = cellValue && typeof cellValue === 'object' && cellValue.richText ?
          cellValue.richText.map(rt => rt.text).join('') :
          (cellValue === null || cellValue === undefined ? '' : cellValue.toString());
      });
      urlJsonData.push(rowData);
    });

    const urls = urlJsonData.map(row => ({
      url: row['url'],
      testIds: (row['test ids'] || '').split(',').map(id => id.trim()).filter(Boolean),
      data: { region: row['region'] || 'N/A' }
    }));

    if (!urls.length) {
      console.error('No URLs found.');
      process.exit(1);
    }

    // Define all possible test IDs for reference
    const allTestIds = [
      'TC-01', 'TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06', 'TC-07', 'TC-08',
      'TC-09', 'TC-10', 'TC-11', 'TC-12', 'TC-13', 'TC-14'
    ];

    // Initialize results array with URL, test IDs, and default values
    const results = urls.map(u => {
      const row = { url: u.url, 'test ids': u.testIds.join(','), region: u.data.region };
      allTestIds.forEach(id => (row[id] = 'NA'));
      row['HTTP Status'] = '-';
      row['Page Pass?'] = 'Not Run';
      return row;
    });

    // Create test run entry in Supabase for tracking
    const runId = `run-${Date.now()}`;
    const { error: testRunError } = await supabase
      .from('test_runs')
      .insert({
        run_id: runId,
        initiated_by: initiatedBy,
        note: 'QA test run initiated via script'
      });
    if (testRunError) {
      console.error('Error creating test run:', testRunError.message || testRunError);
      process.exit(1);
    }
    console.log(`Test Run created with ID: ${runId}`);

    // Initialize crawl progress in Supabase
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
      console.error('Error creating crawl progress:', progressError.message || progressError);
    }

    // Set up directories for screenshots, videos, and debug logs
    const screenshotDir = 'screenshots';
    const videoDir = 'videos';
    const debugDir = 'debug_logs';
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

    // Launch Playwright browser for testing
    const browser = await chromium.launch();
    const defaultContextOptions = { 
      viewport: { width: 1920, height: 1080 } // Default to larger viewport
    };
    const context = await browser.newContext(defaultContextOptions);

    // Set default timeouts: 10s for elements, 45s for navigation
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(45000);

    // Block non-essential resources to optimize performance and prevent survey pop-ups
    await context.route('**/*', route => {
      const url = route.request().url();
      const blocked = [
        'gtm.js',           // Google Tag Manager
        'analytics.js',     // Google Analytics
        '.woff',            // Font files
        '.woff2',           // Font files
        'qualtrics.com',    // Qualtrics survey platform
        'qualified.com',    // Qualified chat platform
        'survey',           // General survey-related requests
        'feedback',         // Feedback-related requests
        'msecnd.net/survey', // Specific survey domain
        'siteintercept'     // Site intercept scripts
      ];
      if (blocked.some(substring => url.includes(substring))) {
        console.log(`Blocked: ${url}`);
        return route.abort();
      }
      return route.continue();
    });

    // Add initialization script to hide overlays and surveys dynamically
    await context.addInitScript(() => {
      const keywords = ['cookie', 'consent', 'gdpr', 'evidon', 'overlay', 'popup', 'survey'];
      const hide = (el) => el && el.style && (el.style.display = 'none');
      new MutationObserver(muts => {
        muts.forEach(m => {
          m.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              const txt = (node.innerText || '').toLowerCase();
              if (keywords.some(k => txt.includes(k)) || 
                  keywords.some(k => node.id?.toLowerCase().includes(k)) || 
                  (node.tagName === 'IFRAME' && node.getAttribute('name')?.includes('survey'))) {
                hide(node);
              }
            }
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    const HTTP_REDIRECT = [301, 302];

    /* Helper Functions */

    // Scroll page to find elements, returns first matching selector
    async function scrollAndFind(page, selectors, maxScreens = 5) {
      const viewH = await page.evaluate(() => window.innerHeight);
      for (let pass = 0; pass < maxScreens; pass++) {
        for (const sel of selectors) {
          if (await page.$(sel)) return sel;
        }
        await page.evaluate(vh => window.scrollBy(0, vh), viewH);
        await page.waitForTimeout(500);
      }
      return null;
    }

    // Perform a JavaScript click on an element using Playwright locator
    async function jsClick(page, selector) {
      const locator = typeof selector === 'string' ? page.locator(selector) : selector;
      if (await locator.count() === 0) return false;
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      return true;
    }

    // Log page DOM for debugging failed tests
    async function logPageDom(page, url, testId) {
      try {
        const safeUrl = url.replace(/[^a-zA-Z0-9_-]/g, '_');
        const debugFile = path.join(debugDir, `${safeUrl}-${testId}-dom.html`);
        const html = await page.evaluate(() => document.documentElement.outerHTML);
        fs.writeFileSync(debugFile, html);
        console.log(`   Debug DOM saved to ${debugFile}`);
      } catch (err) {
        console.error(`   Failed to save debug DOM for ${testId}: ${err.message}`);
      }
    }

    // Upload file to Vercel Blob with retry mechanism
    async function uploadFile(filePath, destPath, retries = 3) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('BLOB_READ_WRITE_TOKEN is not set in the environment.');
        return null;
      }
      if (!fs.existsSync(filePath)) {
        console.error(`File not found for upload: ${filePath}`);
        return null;
      }
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const fileBuffer = fs.readFileSync(filePath);
          const blob = await put(destPath, fileBuffer, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN,
            allowOverwrite: true,
          });
          fs.unlinkSync(filePath);
          console.log(`Uploaded ${destPath} to Vercel Blob: ${blob.url}`);
          return blob.url;
        } catch (error) {
          if (attempt < retries) {
            console.warn(`Attempt ${attempt} failed to upload ${filePath}: ${error.message}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            console.error(`Failed to upload ${filePath} after ${retries} attempts: ${error.message}`);
            return null;
          }
        }
      }
    }

    // Delete file with retry mechanism, continue if it fails
    async function deleteFile(filePath, retries = 3) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted file: ${filePath}`);
          }
          return;
        } catch (error) {
          if (attempt < retries) {
            console.warn(`Attempt ${attempt} failed to delete ${filePath}: ${error.message}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            console.error(`Failed to delete ${filePath} after ${retries} attempts: ${error.message}. Continuing...`);
          }
        }
      }
    }

    // Update crawl progress in Supabase with ETA
    async function updateProgress(completed, startTime) {
      const now = new Date();
      const elapsedMs = now - new Date(startTime);
      const urlsPerMs = completed > 0 ? completed / elapsedMs : 0;
      const remainingUrls = totalUrls - completed;
      const estimatedMsLeft = urlsPerMs > 0 ? remainingUrls / urlsPerMs : Infinity;
      const estimatedDone = estimatedMsLeft === Infinity ? 'N/A' : new Date(now.getTime() + estimatedMsLeft).toISOString();

      const percentage = totalUrls > 0 ? Math.round((completed / totalUrls) * 100) : 100;
      const minutesLeft = estimatedMsLeft === Infinity ? 'N/A' : Math.ceil(estimatedMsLeft / 60000);
      const statusSummary = `Your test is ${percentage}% done. Estimated time left: ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`;

      const { error } = await supabase
        .from('crawl_progress')
        .update({
          urls_completed: completed,
          estimated_done: estimatedDone === 'N/A' ? null : estimatedDone,
          status_summary: statusSummary
        })
        .eq('run_id', runId);

      if (error) console.error('Error updating crawl progress:', error.message || error);
    }

    // Insert test result into Supabase
    async function insertTestResult(url, region, testId, result, errorDetails, screenshotUrl, videoUrl) {
      const { error } = await supabase
        .from('test_results')
        .insert({
          run_id: runId,
          url,
          region_code: region,
          test_id: testId,
          result,
          error_details: errorDetails,
          screenshot_path: screenshotUrl,
          video_path: videoUrl
        });
      if (error) console.error(`Error inserting test result for ${testId} on ${url}:`, error.message || error);
    }

    // Handle Gatekeeper interstitial if present
    async function handleGatekeeper(page, url) {
      const gatekeeperSelectors = ['section.ge-gatekeeper', '[class*="gatekeeper"]'];
      const yesButtonSelector = 'button.ge-gatekeeper-button.ge-button--solid-primary';
      let gatekeeperDetected = false;
      try {
        for (const selector of gatekeeperSelectors) {
          const gatekeeper = await page.waitForSelector(selector, { timeout: 10000 });
          if (gatekeeper) {
            gatekeeperDetected = true;
            console.log(`   Gatekeeper detected with selector: ${selector}`);
            const yesButton = await page.waitForSelector(yesButtonSelector, { timeout: 3000 });
            if (yesButton) {
              await yesButton.click();
              console.log('   Clicked "Yes" on gatekeeper');
              await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
              console.log('   Navigated after gatekeeper');
            }
            break;
          }
        }
      } catch (error) {
        console.log('   No gatekeeper found or error handling:', error.message);
      }
      console.log(`   Gatekeeper detection result: ${gatekeeperDetected}`);
      return gatekeeperDetected;
    }

    // Handle overlays (e.g., cookie banners) dynamically
    async function handleOverlays(page) {
      const overlaySelectors = [
        'div#_evidon_banner',
        'div[id*="cookie"]',
        'div[class*="cookie"]',
        '[role="dialog"]',
        '[aria-label*="cookie"]'
      ];
      const buttonKeywords = ['accept', 'agree', 'ok', 'allow', 'confirm', 'dismiss', 'got it', 'understand', 'close', 'confirmer'];

      try {
        console.log('   Checking for overlays (cookie banners or interstitials)...');
        const overlay = await page.waitForSelector(overlaySelectors.join(', '), { timeout: 2000 });
        if (overlay) {
          console.log('   Overlay detected');
          const buttons = await overlay.$$('button, [role="button"], a');
          for (const button of buttons) {
            const text = (await button.textContent()).toLowerCase();
            if (buttonKeywords.some(keyword => text.includes(keyword))) {
              console.log(`   Clicking overlay button: ${text}`);
              await button.click();
              await page.waitForTimeout(1000);
              console.log('   Overlay dismissed');
              return true;
            }
          }
          console.log('   No dismiss button found, relying on init script to hide overlay');
          return true;
        } else {
          console.log('   No overlay detected within timeout');
        }
      } catch (error) {
        console.log('   No overlay found or error handling:', error.message);
      }
      return false;
    }

    // Handle survey pop-up if present
    async function handleSurvey(page) {
      const surveySelectors = [
        'iframe[name*="survey"]',           // Targets survey iframe by name attribute
        'iframe[id="cs-native-frame"]',     // Targets specific survey iframe by ID
        '.survey',                          // Generic survey class
        '.modal-survey',                    // Modal survey class
        '[id*="survey"]',                   // Elements with survey in ID
        'button[aria-label="Close"]',       // Close button by aria-label
        'button[class*="dismiss"]'          // Dismiss buttons by class
      ];

      for (const selector of surveySelectors) {
        try {
          const element = await page.waitForSelector(selector, { timeout: 2000 });
          if (element) {
            await element.click();
            console.log(`   Survey dismissed using selector: ${selector}`);
            return true;
          }
        } catch (e) {
          // Ignore and continue to the next selector
        }
      }
      console.log('   No survey pop-up found or unable to dismiss');
      return false;
    }

    const allScreenshotUrls = [];
    const allVideoUrls = [];

    // Process a single URL with its associated tests
    async function runUrl(urlData, idx) {
      const url = urlData.url;
      const testIds = urlData.testIds;
      const region = urlData.data.region;
      console.log(`[${idx + 1}/${urls.length}] ${url}`);
      const t0 = Date.now();

      // Validate URL format
      if (!url || !/^https?:\/\//.test(url)) {
        console.log(`Invalid URL: ${url}`);
        results[idx]['HTTP Status'] = 'Invalid URL';
        for (const id of testIds) {
          results[idx][id] = 'NA';
        }
        await updateProgress(idx + 1, startTime);
        return;
      }

      let page, resp, pageError = null;
      let contextToUse = context;
      let gatekeeperDetected = false;

      // Use a fresh context for TC-10 and TC-12 to simulate incognito mode
      if (testIds.includes('TC-10') || testIds.includes('TC-12')) {
        contextToUse = await browser.newContext(defaultContextOptions);
        contextToUse.setDefaultTimeout(10000);
        contextToUse.setDefaultNavigationTimeout(45000);
        await contextToUse.route('**/*', route => {
          const url = route.request().url();
          const blocked = [
            'gtm.js',
            'analytics.js',
            '.woff',
            '.woff2',
            'qualtrics.com',
            'qualified.com',
            'survey',
            'feedback',
            'msecnd.net/survey',
            'siteintercept'
          ];
          if (blocked.some(substring => url.includes(substring))) {
            console.log(`Blocked: ${url}`);
            return route.abort();
          }
          return route.continue();
        });
        await contextToUse.addInitScript(() => {
          const keywords = ['cookie', 'consent', 'gdpr', 'evidon', 'overlay', 'popup', 'survey'];
          const hide = (el) => el && el.style && (el.style.display = 'none');
          new MutationObserver(muts => {
            muts.forEach(m => {
              m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                  const txt = (node.innerText || '').toLowerCase();
                  if (keywords.some(k => txt.includes(k)) || 
                      keywords.some(k => node.id?.toLowerCase().includes(k)) || 
                      (node.tagName === 'IFRAME' && node.getAttribute('name')?.includes('survey'))) {
                    hide(node);
                  }
                }
              });
            });
          }).observe(document.documentElement, { childList: true, subtree: true });
        });
      }

      page = await contextToUse.newPage();

      try {
        console.log('   Navigating to URL...');
        resp = await pTimeout(page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' }), 45000, 'Navigation timeout');
        console.log('   Navigation completed');
        gatekeeperDetected = await handleGatekeeper(page, url);
        await handleOverlays(page);
        await handleSurvey(page); // Handle survey pop-up after other interstitials
      } catch (error) {
        console.log(`   Navigation error for ${url}: ${error.message}`);
        pageError = `Navigation failed: ${error.message}`;
        results[idx]['HTTP Status'] = 'Navigation Error';
        const validTestIds = testIds.filter(id => allTestIds.includes(id));
        for (const id of validTestIds) {
          results[idx][id] = 'Fail';
          await insertTestResult(url, region, id, 'fail', `Navigation failed: ${error.message}`, null, null);
        }
        testIds.filter(id => !allTestIds.includes(id)).forEach(id => {
          results[idx][id] = 'NA';
        });
        await page.close();
        if (contextToUse !== context) await contextToUse.close();
        await updateProgress(idx + 1, startTime);
        console.log(`     ❌ Failed navigation ${(Date.now() - t0) / 1000}s`);
        return;
      }

      results[idx]['HTTP Status'] = resp ? resp.status() : 'N/A';

      const failedTestIds = [];
      const validTestIds = testIds.filter(id => allTestIds.includes(id));
      if (testIds.length !== validTestIds.length) {
        const invalid = testIds.filter(id => !allTestIds.includes(id)).join(', ');
        console.log(`   Warning: Invalid test IDs [${invalid}] ignored.`);
        testIds.filter(id => !allTestIds.includes(id)).forEach(id => {
          results[idx][id] = 'NA';
        });
      }

      const defaultViewport = { width: 1920, height: 1080 };
      const mobileViewport = { width: 375, height: 667 };

      // Execute each test case for the URL
      for (const id of allTestIds) {
        if (!validTestIds.includes(id)) continue;

        let pass = false;
        let errorDetails = '';
        try {
          if (['TC-07', 'TC-11'].includes(id)) {
            page.setDefaultTimeout(15000);
          } else {
            page.setDefaultTimeout(10000);
          }

          if (id === 'TC-02') {
            await page.setViewportSize(mobileViewport);
            await page.waitForTimeout(1000);
          }

          switch (id) {
            case 'TC-01': {
              const heroText = await page.$('section.ge-homepage-hero-v2-component .ge-homepage-hero-v2__text-content');
              pass = heroText && await heroText.isVisible();
              errorDetails = pass ? '' : 'Hero text not found or not visible in hero section';
              break;
            }
            case 'TC-02': {
              const heroText = await page.$('div[id*="ge-homepage-hero"] .ge-homepage-hero-v2__text-content, section.ge-homepage-hero-v2-component .ge-homepage-hero-v2__text-content');
              pass = heroText && await heroText.isVisible();
              errorDetails = pass ? '' : 'Hero text not found or not visible on mobile viewport';
              break;
            }
            case 'TC-03': {
              pass = !!(await page.$('header, [class*="header"]'));
              errorDetails = pass ? '' : 'Header element not found';
              break;
            }
            case 'TC-04': {
              pass = !!(await page.$('nav, [class*="nav"]'));
              errorDetails = pass ? '' : 'Navigation element not found';
              break;
            }
            case 'TC-05': {
              pass = !!(await page.$('main, [class*="main"]'));
              errorDetails = pass ? '' : 'Main content element not found';
              break;
            }
            case 'TC-06': {
              pass = !!(await page.$('footer, [class*="footer"]'));
              errorDetails = pass ? '' : 'Footer element not found';
              break;
            }
            case 'TC-07': {
              console.log(`   TC-07: Starting for ${url}`);
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(500);

              if (await page.$('video, video[data-testid="hls-video"], iframe[src*="vidyard"], [data-testid*="video"]')) {
                pass = true;
                console.log(`   TC-07: Video found directly`);
                break;
              }

              console.log(`   TC-07: No video found, searching for play button`);
              const playButtonSelector = await scrollAndFind(page, [
                '.eds-rd-play',
                '.eds-rd-play-icon',
                '.ge-contentTeaser__content-section__contentTeaserHero-play-icon',
                '.ge-contentTeaser__content-section__contentTeaserHero__img-container',
                '[class*="play-button"]',
                '[data-testid*="play"]'
              ], 5);

              if (!playButtonSelector) {
                pass = false;
                errorDetails = 'Play button/element not found';
                console.log(`   TC-07: Play button not found`);
                await logPageDom(page, url, 'TC-07');
                break;
              }

              const playButton = page.locator(playButtonSelector);
              console.log(`   TC-07: Found play button: ${playButtonSelector}`);

              const imgContainer = page.locator('.ge-contentTeaser__content-section__contentTeaserHero__img-container');
              if (await imgContainer.count()) {
                await imgContainer.first().scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);
              } else {
                await playButton.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);
              }

              if (await imgContainer.count()) {
                await imgContainer.first().hover();
                await page.waitForTimeout(500);
              } else {
                const parent = playButton.locator('xpath=..');
                await parent.hover();
                await page.waitForTimeout(500);
              }

              const isVisible = await page.evaluate((sel) => {
                const elem = document.querySelector(sel);
                if (!elem) return false;
                const style = window.getComputedStyle(elem);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const rect = elem.getBoundingClientRect();
                return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
              }, playButtonSelector);

              if (!isVisible) {
                pass = false;
                errorDetails = 'Play button not visible after scrolling and hovering';
                console.log(`   TC-07: Play button not visible`);
                await logPageDom(page, url, 'TC-07');
                break;
              }

              await playButton.click();
              console.log(`   TC-07: Clicked play button, waiting for modal`);

              const modal = await page.waitForSelector(
                'div.ge-modal-window, div.ge-contentTeaser__content-section__video-modal, div.ge-contentTeaser__content-section__vidyard-video-modal',
                { timeout: 10000 }
              ).catch(() => null);
              if (!modal) {
                pass = false;
                errorDetails = 'Video modal did not open';
                console.log(`   TC-07: Modal did not open`);
                await logPageDom(page, url, 'TC-07');
                break;
              }

              console.log(`   TC-07: Modal opened, waiting for Vidyard player`);
              pass = await page.waitForSelector(
                'div.vidyard-player-container, iframe[src*="play.vidyard.com"], video',
                { timeout: 10000 }
              ).then(() => true).catch(() => false);
              errorDetails = pass ? '' : 'Vidyard player or iframe not found after modal opened';
              console.log(`   TC-07: Vidyard player check: ${pass ? 'Pass' : 'Fail'}`);
              if (!pass) await logPageDom(page, url, 'TC-07');
              break;
            }
            case 'TC-08': {
              console.log(`   TC-08: Starting for ${url}`);
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(500);

              const initialForms = await page.$$('form');
              const initialFormCount = initialForms.length;
              console.log(`   TC-08: Initial form count: ${initialFormCount}`);

              let contact = page.locator('button[name="Open Form Overlay"], a[name="Open Form Overlay"]').first();

              if (!(await contact.count())) {
                contact = page.locator('section.ge-category-hero button, section.campaign-hero__ctas-primary button, section.ge-category-hero a, section.campaign-hero__ctas-primary a')
                  .filter({ hasText: /contact|request|demander/i })
                  .first();
              }

              if (!(await contact.count())) {
                contact = page.locator('button')
                  .filter({ hasText: /contact|request|demander/i })
                  .first();
              }
              if (!(await contact.count())) {
                contact = page.locator('a')
                  .filter({ hasText: /contact|request|demander/i })
                  .first();
              }

              if (!(await contact.count())) {
                contact = page.locator('[data-analytics-link-type="Category Hero"], [data-analytics-link-type="Campaign Hero"], [data-analytics-link-type="Contact Widget"]')
                  .filter({ hasText: /contact|request|demander/i })
                  .first();
              }

              if (!(await contact.count())) {
                console.log('   TC-08: No contact button or link found');
                pass = false;
                errorDetails = 'No contact button or link found';
                await logPageDom(page, url, 'TC-08');
                break;
              }

              console.log(`   TC-08: Found contact element: ${await contact.textContent()}`);

              try {
                await contact.waitFor({ state: 'visible', timeout: 20000 });
              } catch (e) {
                console.log('   TC-08: Contact element not visible within 20 seconds');
                pass = false;
                errorDetails = 'Contact element not visible';
                await logPageDom(page, url, 'TC-08');
                break;
              }

              await contact.scrollIntoViewIfNeeded();
              await contact.click({ force: true });

              console.log(`   TC-08: Waiting for form count to increase`);
              pass = await page.waitForFunction(
                prevCount => document.querySelectorAll('form').length > prevCount,
                initialFormCount,
                { timeout: 10000 }
              ).then(() => true).catch(() => false);
              errorDetails = pass ? '' : `Form count did not increase (initial: ${initialFormCount}, current: ${await page.evaluate(() => document.querySelectorAll('form').length)})`;
              console.log(`   TC-08: Form count check: ${pass ? 'Pass' : 'Fail'}`);
              if (!pass) await logPageDom(page, url, 'TC-08');
              break;
            }
            case 'TC-09': {
              const errorText = 'A rendering error occurred';
              const pageContent = await page.content();
              pass = !pageContent.includes(errorText);
              errorDetails = pass ? '' : `Page content contains "${errorText}"`;
              break;
            }
            case 'TC-10': {
              console.log(`   TC-10: Checking gatekeeper handling for ${url}`);
              console.log(`   TC-10: Gatekeeper detected: ${gatekeeperDetected}, HTTP status: ${resp ? resp.status() : 'N/A'}, Final URL: ${page.url()}`);
              pass = gatekeeperDetected && resp && resp.status() === 200;
              errorDetails = pass ? '' : gatekeeperDetected ? 
                `Page did not load successfully after gatekeeper (status: ${resp ? resp.status() : 'N/A'})` : 
                'Gatekeeper UI not detected when expected';
              if (!pass) await logPageDom(page, url, 'TC-10');
              console.log(`   TC-10: Result: ${pass ? 'Pass' : 'Fail'} (${errorDetails})`);
              break;
            }
            case 'TC-11': {
              console.log(`   TC-11: Starting for ${url}`);
              await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
              await page.waitForTimeout(3000);
              const insightsLinkSelectors = [
                'a[href*="/insights"]',
                'a[href*="/newsroom"]',
                '.ge-press-cards__item a[href]',
                '.related-content-app-product-cards__image_container a[href]',
                '.related-content-insights-app-product-cards__image_container a[href]',
                '.related-content__container a[href]',
                '.ge-newsroom-article-card a[href]',
                '.content-list-articles-wrapper a[href]',
                '[class*="article"] a[href]'
              ];
              let insightsLink = null;
              let selectedHref = null;
              for (const selector of insightsLinkSelectors) {
                insightsLink = await page.$(selector);
                if (insightsLink) {
                  selectedHref = await insightsLink.getAttribute('href');
                  if (selectedHref) break;
                }
              }
              if (!insightsLink || !selectedHref) {
                pass = false;
                errorDetails = 'No valid insights/newsroom link with href found';
                console.log(`   TC-11: No valid link found`);
                await logPageDom(page, url, 'TC-11');
                break;
              }
              const targetUrl = new URL(selectedHref, page.url()).toString();
              console.log(`   TC-11: Navigating to ${targetUrl}`);
              const newPage = await contextToUse.newPage();
              const response = await newPage.goto(targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
              pass = !!response && response.status() === 200;
              errorDetails = pass ? '' : `Navigating to ${targetUrl} resulted in status ${response ? response.status() : 'N/A'}`;
              console.log(`   TC-11: Navigation result: ${pass ? 'Pass' : 'Fail'}`);
              if (!pass) await logPageDom(newPage, targetUrl, 'TC-11');
              await newPage.close();
              break;
            }
            case 'TC-12': {
              console.log(`   TC-12: Final URL: ${page.url()}`);
              const finalUrl = page.url();
              pass = finalUrl.includes('/account/doccheck-login');
              errorDetails = pass ? '' : `Expected redirect to "/account/doccheck-login" not found: ${finalUrl}`;
              if (!pass) await logPageDom(page, url, 'TC-12');
              break;
            }
            case 'TC-13': {
              console.log(`   TC-13: Starting for ${url}`);
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(500);

              const produkteButton = page.getByRole('button', { name: 'Produkte' }).first();
              try {
                await produkteButton.waitFor({ state: 'visible', timeout: 30000 });
                console.log('   TC-13: Produkte button found and visible');
              } catch (e) {
                console.log('   TC-13: Produkte button not found or not visible within 30s');
                pass = false;
                errorDetails = 'Produkte button not found or not visible';
                await logPageDom(page, url, 'TC-13');
                break;
              }
              console.log(`   TC-13: Clicking Produkte button`);
              await produkteButton.click();

              let ultraschallButton = page.getByRole('button', { name: 'Ultraschall' });
              try {
                await ultraschallButton.waitFor({ state: 'visible', timeout: 10000 });
                console.log('   TC-13: Ultraschall submenu item found and visible via role');
              } catch (e) {
                console.log('   TC-13: Ultraschall not found via role, trying fallback');
                ultraschallButton = page.locator('.menu-content-container-item-data', { hasText: 'Ultraschall' });
                await ultraschallButton.waitFor({ state: 'visible', timeout: 5000 });
                if (!(await ultraschallButton.isVisible())) {
                  console.log('   TC-13: Ultraschall submenu item not found or not visible within 15s');
                  pass = false;
                  errorDetails = 'Ultraschall submenu item not found or not visible';
                  await logPageDom(page, url, 'TC-13');
                  break;
                }
                console.log('   TC-13: Ultraschall submenu item found via fallback');
              }
              console.log(`   TC-13: Clicking Ultraschall submenu item`);
              await ultraschallButton.click();

              const moreLink = page.locator('a[href="https://www.ge-ultraschall.com/"]');
              try {
                await moreLink.waitFor({ state: 'visible', timeout: 30000 });
                console.log('   TC-13: Found "Mehr erfahren" link by href');
              } catch (error) {
                console.log('   TC-13: "Mehr erfahren" link not found by href within 30 seconds');
                const moreLinkByText = page.locator('a', { hasText: /> Mehr erfahren/i });
                await moreLinkByText.waitFor({ state: 'visible', timeout: 5000 });
                if (!(await moreLinkByText.isVisible())) {
                  console.log('   TC-13: Fallback link not found or not visible');
                  pass = false;
                  errorDetails = '"Mehr erfahren" link not found or not visible';
                  await logPageDom(page, url, 'TC-13');
                  break;
                }
                console.log('   TC-13: Found "Mehr erfahren" link via text fallback');
              }

              console.log(`   TC-13: Clicking "Mehr erfahren" link`);
              await moreLink.scrollIntoViewIfNeeded();
              await moreLink.click();

              await page.waitForNavigation({ timeout: 30000 }).catch(() => {
                console.log('   TC-13: Navigation wait timed out, proceeding with current URL');
              });

              const dest = page.url();
              console.log(`   TC-13: Navigated to ${dest}`);
              pass = dest.startsWith('https://gehealthcare-ultrasound.com/') || dest.startsWith('https://www.ge-ultraschall.com/');
              errorDetails = pass ? '' : `Navigation did not go to expected ultrasound site: ${dest}`;
              if (!pass) await logPageDom(page, url, 'TC-13');
              break;
            }
            case 'TC-14': {
              const c = resp ? resp.status() : 0;
              pass = (c >= 200 && c < 300) || HTTP_REDIRECT.includes(c);
              errorDetails = pass ? '' : `HTTP Status was ${c}, expected 2xx or 3xx`;
              break;
            }
            default: {
              pass = false;
              errorDetails = `Unsupported Test ID: ${id}`;
              console.warn(errorDetails);
            }
          }
        } catch (err) {
          console.log(`   EXCEPTION for ${id}: ${err.message}`);
          pass = false;
          errorDetails = `Exception during test execution for ${id}: ${err.message}`;
          await logPageDom(page, url, id);
          const safeUrl = url.replace(/[^a-zA-Z0-9_-]/g, '_');
          const screenshotPath = `${screenshotDir}/${safeUrl}-${id}-exception.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true })
            .catch(screenshotErr => console.error(`Screenshot failed during exception for ${id}: ${screenshotErr.message}`));
        } finally {
          if (id === 'TC-02') {
            await page.setViewportSize(defaultViewport);
            await page.waitForTimeout(1000);
          }
        }

        results[idx][id] = pass ? 'Pass' : 'Fail';
        const result = pass ? 'pass' : 'fail';
        await insertTestResult(url, region, id, result, errorDetails, null, null);
        if (!pass) failedTestIds.push(id);
      }

      let screenshotUrl = null;
      let videoUrl = null;
      const safeUrl = url.replace(/[^a-zA-Z0-9_-]/g, '_');

      if (failedTestIds.length > 0) {
        await page.waitForTimeout(2000);
        const screenshotFileName = `${safeUrl}-failed-${failedTestIds.join(',')}.png`;
        const screenshotPath = path.join(screenshotDir, screenshotFileName);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotUrl = await uploadFile(screenshotPath, `screenshots/${screenshotFileName}`);
        if (screenshotUrl) console.log(`Screenshot uploaded: ${screenshotUrl}`);

        if (captureVideo) {
          const videoContext = await browser.newContext({
            recordVideo: { dir: videoDir, timeout: 15000 },
            viewport: defaultViewport
          });
          const videoPage = await videoContext.newPage();
          await videoPage.goto(url, { waitUntil: 'domcontentloaded' });
          await videoPage.waitForTimeout(5000);
          const videoPath = await videoPage.video().path();
          await videoContext.close();
          const uniqueId = uuidv4();
          const videoFileName = `${safeUrl}-${uniqueId}.webm`;
          const finalVideoPath = path.join(videoDir, videoFileName);
          await fs.promises.rename(videoPath, finalVideoPath);
          videoUrl = await uploadFile(finalVideoPath, `videos/${videoFileName}`);
          if (videoUrl) console.log(`Video uploaded: ${videoUrl}`);
        }
      }

      if ((screenshotUrl || videoUrl) && failedTestIds.length > 0) {
        const { error: updateError } = await supabase
          .from('test_results')
          .update({
            screenshot_path: screenshotUrl,
            video_path: videoUrl
          })
          .eq('run_id', runId)
          .eq('url', url)
          .in('test_id', failedTestIds);
        if (updateError) console.error('Error updating test results with media URLs:', updateError.message || updateError);
      }

      if (screenshotUrl) allScreenshotUrls.push(screenshotUrl);
      if (videoUrl) allVideoUrls.push(videoUrl);

      const relevantTestResults = validTestIds.map(id => results[idx][id]);
      let pagePassStatus = 'NA';
      if (relevantTestResults.length > 0) {
        pagePassStatus = relevantTestResults.includes('Fail') ? 'Fail' : 'Pass';
      }
      results[idx]['Page Pass?'] = pagePassStatus;

      await updateProgress(idx + 1, startTime);
      console.log(`     ✔ ${(Date.now() - t0) / 1000}s`);
      await page.close();
      if (contextToUse !== context) await contextToUse.close();
    }

    // Process URLs in batches with concurrency control
    const CONCURRENCY = 3;
    const urlBatches = [];
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      urlBatches.push(urls.slice(i, i + CONCURRENCY));
    }

    for (let batchIndex = 0; batchIndex < urlBatches.length; batchIndex++) {
      const batch = urlBatches[batchIndex];
      console.log(`\n➡  Batch ${batchIndex + 1}/${urlBatches.length}`);
      await Promise.all(
        batch.map((urlData, j) =>
          pTimeout(runUrl(urlData, batchIndex * CONCURRENCY + j), 90000, `URL processing timeout for ${urlData.url}`)
            .catch(async (err) => {
              console.error(`Timeout or error for ${urlData.url}: ${err.message}`);
              results[batchIndex * CONCURRENCY + j]['Page Pass?'] = 'Fail';
              if (results[batchIndex * CONCURRENCY + j]['HTTP Status'] === '-') {
                results[batchIndex * CONCURRENCY + j]['HTTP Status'] = 'Timeout/Error';
              }
              await updateProgress(batchIndex * CONCURRENCY + j + 1, startTime);
            })
        )
      );
      if (batchIndex < urlBatches.length - 1) {
        console.log('   Waiting 5 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Finalize crawl progress in Supabase
    await supabase
      .from('crawl_progress')
      .update({
        status: 'completed',
        estimated_done: new Date().toISOString(),
        status_summary: 'Your test is complete. Finalizing results.'
      })
      .eq('run_id', runId);

    // Summarize results
    const total = results.length;
    const passed = results.filter(r => r['Page Pass?'] === 'Pass').length;
    const failed = results.filter(r => r['Page Pass?'] === 'Fail').length;
    const na = results.filter(r => r['Page Pass?'] === 'NA').length;

    console.log(`\nSummary: ${passed}/${total} pages passed, ${failed} failed, ${na} N/A.`);
    const testFailureSummary = {};
    allTestIds.forEach(id => {
      const f = results.filter(r => r[id] === 'Fail').length;
      if (f > 0) {
        console.log(`  • ${f} × ${id}`);
        testFailureSummary[id] = f;
      }
    });

    const failedUrlsList = [];
    const urlResults = [];
    for (const result of results) {
      const pagePassStatus = result['Page Pass?'];
      if (pagePassStatus === 'Fail') {
        const failedTestsForUrl = allTestIds.filter(id => result[id] === 'Fail');
        failedUrlsList.push({ url: result['url'], failedTests: failedTestsForUrl });
      }
      urlResults.push({
        url: result['url'],
        passed: pagePassStatus === 'Pass',
        ...(pagePassStatus === 'Fail' && { failedTests: allTestIds.filter(id => result[id] === 'Fail') })
      });
    }

    // Write results to Excel output
    const outputWorkbook = new ExcelJS.Workbook();
    const resultSheet = outputWorkbook.addWorksheet('Results');
    const outputHeaders = ['url', 'region', 'test ids', ...allTestIds, 'Page Pass?', 'HTTP Status'];
    resultSheet.getRow(1).values = outputHeaders;
    results.forEach((result, index) => {
      const rowData = outputHeaders.map(header => result[header] || '');
      resultSheet.getRow(index + 2).values = rowData;
    });

    const metaSheet = outputWorkbook.addWorksheet('Metadata');
    metaSheet.getRow(1).values = ['Run ID', 'Run Date', 'Run Time', 'Initiated By', 'Total URLs', 'Passed', 'Failed', 'N/A', 'Notes'];
    metaSheet.getRow(2).values = [
      runId,
      new Date().toISOString().slice(0, 10),
      new Date().toTimeString().slice(0, 8),
      initiatedBy,
      total,
      passed,
      failed,
      na,
      `Completed run: ${passed} passed, ${failed} failed`
    ];

    await outputWorkbook.xlsx.writeFile(outputFile);
    console.log(`\n✅ Results saved → ${outputFile}\n`);

    // Prepare and send payload to API
    const payload = {
      runId: runId,
      crawlName: 'QA Run',
      date: new Date().toISOString(),
      totalUrls: total,
      passedUrls: passed,
      failedUrls: failed,
      naUrls: na,
      successCount: passed,
      failureCount: failed,
      naCount: na,
      initiatedBy: initiatedBy,
      testFailureSummary,
      failedUrls: failedUrlsList,
      urlResults: urlResults,
      screenshot_paths: allScreenshotUrls,
      video_paths: allVideoUrls
    };

    const summaryFilePath = 'summary.json';
    fs.writeFileSync(summaryFilePath, JSON.stringify(payload, null, 2));
    console.log(`Run summary saved to ${summaryFilePath}`);

    const storeRunBaseUrl = process.env.VERCEL_URL && !process.env.VERCEL_URL.startsWith('http')
      ? `https://${process.env.VERCEL_URL}`
      : process.env.VERCEL_URL || 'http://localhost:3000';
    const storeRunUrl = `${storeRunBaseUrl}/api/store-run`;
    console.log(`Sending run summary to ${storeRunUrl}`);
    try {
      const response = await fetch(storeRunUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Failed to store run: ${response.status} ${response.statusText}`, errorBody);
      } else {
        console.log('Successfully stored run summary via API.');
      }
    } catch (apiError) {
      console.error('Error sending run summary to API:', apiError.message);
    }

    await context.close();
    await browser.close();

    console.log('Script completed successfully. Exiting with code 0.');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error.message || error);
    process.exit(1);
  }
})();