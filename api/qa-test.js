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
  • Extended TC-07 to validate video carousels when present
  • Updated TC-08 with refined Contact Us button selector targeting hero section
  • Updated TC-13 with simplified submenu wait condition for Ultraschall link
  • Added survey handling mechanisms to block and dismiss survey pop-ups
  • Enhanced error logging with full error object output
  • Added minimal insert test to handle nullable fields gracefully
──────────────────────────────────────────────────────────────────────────────*/

// --- Environment variable check for Supabase ---
const isVercel = !!process.env.VERCEL;
const isGithubActions = !!process.env.GITHUB_ACTIONS;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const envSource = isVercel
    ? `Vercel (${process.env.VERCEL_ENV || 'unknown env'})`
    : isGithubActions
      ? 'GitHub Actions'
      : 'local shell';
  console.error(`\n[ERROR] SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are missing!`);
  console.error(`[INFO] Detected environment: ${envSource}`);
  console.error(`[INFO] SUPABASE_URL: ${process.env.SUPABASE_URL ? 'SET' : 'NOT SET'}`);
  console.error(`[INFO] SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET'}`);
  console.error(`\nTo fix: Set these environment variables in your ${envSource} environment.`);
  process.exit(1);
}

import winston from 'winston';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { put } from '@vercel/blob';
import fetch from 'node-fetch';
import pTimeout from 'p-timeout';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';
import { heroTextVisible } from '../utils/hero.js';

// Logger setup (Winston)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [new winston.transports.Console()]
});

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
logger.info(`[ENV DEBUG] Supabase URL: ${process.env.SUPABASE_URL}`);
logger.info(`[ENV DEBUG] Supabase Key starts with: ${process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 8)}`);

// Constants for configuration
const DEFAULT_TIMEOUT = 10000;
const NAVIGATION_TIMEOUT = 45000;
const SCREENSHOT_DIR = 'screenshots';
const VIDEO_DIR = 'videos';
const DEBUG_DIR = 'debug_logs';
const BLOCKED_RESOURCES = [
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
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
const MOBILE_VIEWPORT = { width: 375, height: 667 };
const HTTP_REDIRECT = [301, 302];
const CONCURRENCY = 3;
const BATCH_DELAY = 2000;
const MAX_CAROUSEL_SLIDES = parseInt(process.env.MAX_CAROUSEL_SLIDES || '5', 10);

// Helper to get environment label
const environment = process.env.VERCEL_ENV || 'production';
logger.info(`[ENV DEBUG] Environment: ${environment}`);

// Utility to select environment-aware storage config
function getBlobConfig() {
  const isPreview = process.env.VERCEL_ENV === 'preview';
  return {
    bucket: isPreview ? process.env.TEST_STORAGE_BUCKET : process.env.STORAGE_BUCKET,
    token: isPreview ? process.env.TEST_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN,
    envLabel: isPreview ? 'PREVIEW' : 'PRODUCTION',
  };
}

// Main execution wrapped in an IIFE for async handling
(async () => {
  try {
    logger.info('Starting QA test script');
    const [,, inputFile, outputFile, initiatedBy] = process.argv;
    const captureVideo = process.argv[5] ? process.argv[5].toLowerCase() === 'true' : false;

    // Validate command-line arguments
    if (!inputFile || !outputFile || !initiatedBy) {
      logger.error('Usage: node api/qa-test.js <input.xlsx> <output.xlsx> <Initiated By> [captureVideo=false]');
      process.exit(1);
    }

    logger.info(`\n▶ Workbook  : ${inputFile}`);
    logger.info(`▶ Output    : ${outputFile}`);
    logger.info(`▶ Initiated : ${initiatedBy}`);
    logger.info(`▶ Capture Video: ${captureVideo}\n`);

    // Read Excel input file containing URLs and test data
    logger.info('Reading URLs and data from Excel file...');
    if (!fs.existsSync(inputFile)) {
      logger.error(`Input file not found: ${inputFile}`);
      process.exit(1);
    } else {
      logger.info(`Input file found: ${inputFile}`);
    }
    const inputWorkbook = new ExcelJS.Workbook();
    await inputWorkbook.xlsx.readFile(inputFile);

    const urlSheet = inputWorkbook.getWorksheet('URLs');
    if (!urlSheet) {
      logger.error('Sheet "URLs" not found in input.xlsx.');
      process.exit(1);
    }

    const headerRow = urlSheet.getRow(1);
    const headers = headerRow.values.map(h => h ? h.toString().trim().toLowerCase() : '').filter(Boolean);
    logger.info('Headers detected:', headers);

    const urlIndex = headers.indexOf('url');
    const testIdsIndex = headers.indexOf('test ids');
    const regionIndex = headers.indexOf('region');

    if (urlIndex === -1 || testIdsIndex === -1) {
      logger.error('Required columns "URL" or "Test IDs" not found in URLs sheet.');
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

    logger.info(`[DEBUG] URLs loaded: ${urls.length}`);
    logger.info(`[DEBUG] First 3 URLs: ${urls.slice(0, 3).map(u => u.url).join(', ')}`);

    if (!urls.length) {
      logger.error('No URLs found.');
      process.exit(1);
    }

    logger.info(`Loaded ${urls.length} URLs from input file.`);

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

    // Test minimal insert into test_results to verify nullable field handling
    logger.info('Testing minimal insert into test_results...');
    const { error: minimalInsertError } = await supabase
      .from('test_results')
      .insert({ url: 'https://example.com', environment: 'production' });
    if (minimalInsertError) {
      logger.error('Minimal insert failed:', JSON.stringify(minimalInsertError, null, 2));
    } else {
      logger.info('Minimal insert succeeded.');
    }

    // Create test run entry in Supabase for tracking
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    logger.info(`Attempting to insert test run with run_id: ${runId}, initiated_by: ${initiatedBy}, environment: ${environment}`);
    const { error: testRunError } = await supabase
      .from('test_runs')
      .insert({
        run_id: runId,
        initiated_by: initiatedBy,
        note: 'QA test run initiated via script',
        environment
      });
    if (testRunError) {
      logger.error('Supabase insert error:', JSON.stringify(testRunError, null, 2));
      process.exit(1);
    }
    logger.info(`Test Run created with ID: ${runId}`);

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
        status_summary: 'Your test has started.',
        environment
      });
    if (progressError) {
      logger.error('Error creating crawl progress:', JSON.stringify(progressError, null, 2));
    }

    // Set up directories for screenshots, videos, and debug logs
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);
    if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR);
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR);

    // Launch Playwright browser for testing
    const browser = await chromium.launch();
    const defaultContextOptions = { 
      viewport: DEFAULT_VIEWPORT // Default to larger viewport
    };
    const context = await browser.newContext(defaultContextOptions);

    // Set default timeouts
    context.setDefaultTimeout(DEFAULT_TIMEOUT);
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);

    // Block non-essential resources to optimize performance and prevent survey pop-ups
    await context.route('**/*', route => {
      const url = route.request().url();
      if (BLOCKED_RESOURCES.some(substring => url.includes(substring))) {
        logger.info(`Blocked: ${url}`);
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
                  keywords.some(k => node.id?.toLowerCase().includes(k))) {
                hide(node);
              } else if (node.tagName === 'IFRAME' && node.getAttribute('name')?.includes('survey')) {
                const dialog = node.closest('[role="dialog"]');
                if (dialog) hide(dialog);
                else hide(node);
              }
            }
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    /* Helper Functions */

    // Scroll page to find elements and return the first matching selector
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

    // Advance the video carousel to the next slide if a next-arrow is found
    async function clickNextCarouselButton(page) {
      const nextSelectors = [
        '.ge-product-carousel__arrow--next button',
        '.ge-product-carousel__arrow--next',
        '[data-testid="carousel-arrow-next"]',
        '[aria-label="Next Slide"]',
        '[aria-label="Next"]'
      ];
      for (const sel of nextSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(1000);
          return true;
        }
      }
      return false;
    }

    // Log debugging for failed tests
    async function logPageDom(page, url, testId) {
      try {
        const consoleErrors = await page.evaluate(() => {
          return window.console.errors ? window.console.errors.join('; ') : 'None';
        });

        if (testId === 'TC-08') {
          const bodyOpacity = await page.evaluate(() => document.body.style.opacity || '1');
          const contactButton = await page.$('button[name="Open Form Overlay"], a[name="Open Form Overlay"]');
          const isVisible = contactButton ? await contactButton.isVisible() : false;
          const buttonHtml = contactButton ? await page.$eval('button[name="Open Form Overlay"], a[name="Open Form Overlay"]', el => el.outerHTML) : 'Not found';
          const formCount = await page.$$('form').then(forms => forms.length);

          logger.info(`TC-08 Failure Details:`);
          logger.info(`- Body opacity: ${bodyOpacity}`);
          logger.info(`- Contact button found: ${!!contactButton}`);
          logger.info(`- Contact button visible: ${isVisible}`);
          logger.info(`- Contact button HTML: ${buttonHtml}`);
          logger.info(`- Current form count: ${formCount}`);
          logger.info(`- Console errors: ${consoleErrors}`);
        } else if (testId === 'TC-07') {
          const playButtonSelector = await scrollAndFind(page, [
            '.eds-rd-play',
            '.eds-rd-play-icon',
            '.ge-contentTeaser__content-section__contentTeaserHero-play-icon',
            '.ge-contentTeaser__content-section__contentTeaserHero__img-container',
            '[class*="play-button"]',
            '[data-testid*="play"]'
          ], 5);
          const playButton = playButtonSelector ? await page.$(playButtonSelector) : null;
          const isVisible = playButton ? await playButton.isVisible() : false;
          const playButtonHtml = playButton ? await page.$eval(playButtonSelector, el => el.outerHTML) : 'Not found';
          const modal = await page.$('div.ge-modal-window, div.ge-contentTeaser__content-section__video-modal, div.ge-contentTeaser__content-section__vidyard-video-modal');
          const modalHtml = modal ? await modal.evaluate(el => el.outerHTML) : 'Not found';
          const videoPlayer = await page.$('div.vidyard-player-container, iframe[src*="play.vidyard.com"], video');
          const videoPlayerHtml = videoPlayer ? await videoPlayer.evaluate(el => el.outerHTML) : 'Not found';

          logger.info(`TC-07 Failure Details:`);
          logger.info(`- Play button found: ${!!playButton}`);
          logger.info(`- Play button visible: ${isVisible}`);
          logger.info(`- Play button HTML: ${playButtonHtml}`);
          logger.info(`- Modal found: ${!!modal}`);
          logger.info(`- Modal HTML: ${modalHtml}`);
          logger.info(`- Video player found: ${!!videoPlayer}`);
          logger.info(`- Video player HTML: ${videoPlayerHtml}`);
          logger.info(`- Console errors: ${consoleErrors}`);
        } else {
          logger.info(`${testId} Failure: No specific logging defined. Generic details:`);
          logger.info(`- Console errors: ${consoleErrors}`);
        }
      } catch (err) {
        logger.error(`Failed to log debug details for ${testId}: ${err.message}`);
      }
    }

    // Upload file to Vercel Blob with retry mechanism and enhanced error handling
    async function uploadFile(filePath, destPath, retries = 3) {
      const { token, envLabel, bucket } = getBlobConfig();
      logger.info(`[${envLabel}] Uploading to bucket: ${bucket}, using token: ${token ? 'SET' : 'NOT SET'}`);
      if (!token) throw new Error('Blob storage token is not set in the environment');
      if (!fs.existsSync(filePath)) throw new Error(`File not found for upload: ${filePath}`);
      let lastError;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const fileBuffer = fs.readFileSync(filePath);
          const fullDestPath = bucket ? `${bucket}/${destPath}` : destPath;
          const blob = await put(fullDestPath, fileBuffer, {
            access: 'public',
            token,
            allowOverwrite: true,
          });
          fs.unlinkSync(filePath);
          logger.info(`Uploaded ${fullDestPath} to Vercel Blob: ${blob.url}`);
          return blob.url;
        } catch (error) {
          lastError = error;
          if (attempt < retries) {
            logger.warn(`Attempt ${attempt} failed to upload ${filePath}: ${error.message}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      throw new Error(`Failed to upload ${filePath} after ${retries} attempts: ${lastError.message}`);
    }

    // Delete file with retry mechanism and enhanced error handling
    async function deleteFile(filePath, retries = 3) {
      let lastError;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info(`Deleted file: ${filePath}`);
          }
          return;
        } catch (error) {
          lastError = error;
          if (attempt < retries) {
            logger.warn(`Attempt ${attempt} failed to delete ${filePath}: ${error.message}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      logger.error(`Failed to delete ${filePath} after ${retries} attempts: ${lastError.message}. Continuing...`);
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

      if (error) logger.error('Error updating crawl progress:', JSON.stringify(error, null, 2));
    }

    // Insert test result into Supabase with enhanced error logging
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
          video_path: videoUrl,
          environment
        });
      if (error) {
        logger.error(`Error inserting test result for ${testId} on ${url}:`, JSON.stringify(error, null, 2));
      }
    }

    // Handle Gatekeeper interstitial if present
    async function handleGatekeeper(page, url) {
      const gatekeeperSelectors = ['section.ge-gatekeeper', '[class*="gatekeeper"]'];
      const yesButtonSelector = 'button.ge-gatekeeper-button.ge-button--solid-primary';
      let gatekeeperDetected = false;
      try {
        for (const selector of gatekeeperSelectors) {
          const gatekeeper = await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT });
          if (gatekeeper) {
            gatekeeperDetected = true;
            logger.info(`Gatekeeper detected with selector: ${selector}`);
            const yesButton = await page.waitForSelector(yesButtonSelector, { timeout: 3000 });
            if (yesButton) {
              await yesButton.click();
              logger.info('Clicked "Yes" on gatekeeper');
              await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT });
              logger.info('Navigated after gatekeeper');
            }
            break;
          }
        }
      } catch (error) {
        logger.info('No gatekeeper found or error handling:', error.message);
      }
      logger.info(`Gatekeeper detection result: ${gatekeeperDetected}`);
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
        logger.info('Checking for overlays (cookie banners or interstitials)...');
        const cookieBanner = await page.$('#_evidon_banner');
        if (cookieBanner && await cookieBanner.isVisible()) {
          logger.info('Specific clearfix');
          const declineButton = await page.$('#_evidon-decline-button');
          if (declineButton) {
            await declineButton.click();
            logger.info('Clicked "Allow necessary only" on cookie banner');
            try {
              await page.waitForFunction(() => !document.querySelector('#_evidon_banner'), { timeout: 5000 });
            } catch (e) {
              logger.info('Banner did not disappear, hiding via JavaScript');
              await page.evaluate(() => {
                const banner = document.querySelector('#_evidon_banner');
                if (banner) banner.style.display = 'none';
              });
            }
          } else {
            logger.info('"Allow necessary only" button not found, hiding banner via JavaScript');
            await page.evaluate(() => {
              const banner = document.querySelector('#_evidon_banner');
              if (banner) banner.style.display = 'none';
            });
          }
        } else {
          const overlay = await page.waitForSelector(overlaySelectors.join(', '), { timeout: 5000 });
          if (overlay) {
            logger.info('General overlay detected');
            const buttons = await overlay.$$('button, [role="button"], a');
            for (const button of buttons) {
              const text = (await button.textContent()).toLowerCase();
              if (buttonKeywords.some(keyword => text.includes(keyword))) {
                logger.info(`Clicking overlay button: ${text}`);
                await button.click();
                await page.waitForTimeout(1000);
                logger.info('Overlay dismissed');
                return true;
              }
            }
            logger.info('No dismiss button found, relying on init script to hide overlay');
            return true;
          } else {
            logger.info('No overlay detected within timeout');
          }
        }
      } catch (error) {
        logger.info('No overlay found or error handling:', error.message);
      }
      return false;
    }

    // Handle survey pop-up if present
    async function handleSurvey(page) {
      const surveyContainerSelector = 'div.QSIWebResponsive';
      const closeButtonSelector = `${surveyContainerSelector} button[aria-label="Close"]`;

      try {
        const closeButton = await page.waitForSelector(closeButtonSelector, { timeout: 2000 });
        if (closeButton) {
          await closeButton.click();
          logger.info('Survey dismissed by clicking close button');
          return true;
        }
      } catch (e) {
        logger.info('No survey pop-up found or unable to dismiss');
      }
      return false;
    }

    const allScreenshotUrls = [];
    const allVideoUrls = [];

    // Process a single URL with its associated tests
    async function runUrl(urlData, idx) {
      const url = urlData.url;
      const testIds = urlData.testIds;
      const region = urlData.data.region;
      logger.info(`[${idx + 1}/${urls.length}] ${url}`);
      const t0 = Date.now();

      // Validate URL format
      if (!url || !/^https?:\/\//.test(url)) {
        logger.warn(`Invalid URL: ${url}`);
        results[idx]['HTTP Status'] = 'Invalid URL';
        for (const id of testIds) results[idx][id] = 'NA';
        await updateProgress(idx + 1, startTime);
        return;
      }

      let page, resp, pageError = null;
      let contextToUse = context;
      let gatekeeperDetected = false;

      // Use a fresh context for TC-10 and TC-12 to simulate incognito mode
      if (testIds.includes('TC-10') || testIds.includes('TC-12')) {
        contextToUse = await browser.newContext(defaultContextOptions);
        contextToUse.setDefaultTimeout(DEFAULT_TIMEOUT);
        contextToUse.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
        await contextToUse.route('**/*', route => {
          const url = route.request().url();
          if (BLOCKED_RESOURCES.some(substring => url.includes(substring))) {
            logger.info(`Blocked: ${url}`);
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
        logger.info('Navigating to URL...');
        resp = await pTimeout(page.goto(url, { timeout: NAVIGATION_TIMEOUT, waitUntil: 'domcontentloaded' }), NAVIGATION_TIMEOUT, 'Navigation timeout');
        logger.info('Navigation completed');
        gatekeeperDetected = await handleGatekeeper(page, url);
        await handleOverlays(page);
        await handleSurvey(page);
      } catch (error) {
        logger.error(`Navigation error for ${url}: ${error.message}`);
        pageError = `Navigation failed: ${error.message}`;
        results[idx]['HTTP Status'] = 'Navigation Error';
        const validTestIds = testIds.filter(id => allTestIds.includes(id));
        for (const id of validTestIds) {
          results[idx][id] = 'Fail';
          await insertTestResult(url, region, id, 'fail', `Navigation failed: ${error.message}`, null, null);
        }
        testIds.filter(id => !allTestIds.includes(id)).forEach(id => results[idx][id] = 'NA');
        await page.close();
        if (contextToUse !== context) await contextToUse.close();
        await updateProgress(idx + 1, startTime);
        logger.error(`❌ Failed navigation ${(Date.now() - t0) / 1000}s`);
        return;
      }

      results[idx]['HTTP Status'] = resp ? resp.status() : 'N/A';

      const failedTestIds = [];
      const validTestIds = testIds.filter(id => allTestIds.includes(id));
      if (testIds.length !== validTestIds.length) {
        const invalid = testIds.filter(id => !allTestIds.includes(id)).join(', ');
        logger.warn(`Warning: Invalid test IDs [${invalid}] ignored.`);
        testIds.filter(id => !allTestIds.includes(id)).forEach(id => results[idx][id] = 'NA');
      }

      // Execute each test case for the URL
      for (const id of allTestIds) {
        if (!validTestIds.includes(id)) continue;
        await handleSurvey(page);

        let pass = false;
        let errorDetails = '';
        try {
          if (['TC-07', 'TC-11'].includes(id)) page.setDefaultTimeout(15000);
          else page.setDefaultTimeout(DEFAULT_TIMEOUT);

          if (id === 'TC-02') {
            await page.setViewportSize(MOBILE_VIEWPORT);
            await page.waitForTimeout(1000);
          }

          switch (id) {
            case 'TC-01': {
              pass = await heroTextVisible(page);
              errorDetails = pass ? '' : 'Hero text not found or not visible in hero section';
              break;
            }
            case 'TC-02': {
              pass = await heroTextVisible(page);
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
              logger.info(`TC-07: Starting for ${url}`);
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(500);

              if (await page.$('video, video[data-testid="hls-video"], iframe[src*="vidyard"], [data-testid*="video"]')) {
                pass = true;
                logger.info(`TC-07: Video found directly`);
                break;
              }

              logger.info(`TC-07: No video found, searching for play button`);
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
                logger.warn(`TC-07: Play button not found`);
                await logPageDom(page, url, 'TC-07');
                break;
              }

              const playButton = page.locator(playButtonSelector);
              logger.info(`TC-07: Found play button: ${playButtonSelector}`);

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
                logger.warn(`TC-07: Play button not visible`);
                await logPageDom(page, url, 'TC-07');
                break;
              }

              await playButton.click();
              logger.info(`TC-07: Clicked play button, waiting for modal`);

              const modal = await page.waitForSelector(
                'div.ge-modal-window, div.ge-contentTeaser__content-section__video-modal, div.ge-contentTeaser__content-section__vidyard-video-modal',
                { timeout: 10000 }
              ).catch(() => null);
              if (!modal) {
                pass = false;
                errorDetails = 'Video modal did not open';
                logger.warn(`TC-07: Modal did not open`);
                await logPageDom(page, url, 'TC-07');
                break;
              }

              logger.info(`TC-07: Modal opened, waiting for Vidyard player`);
              pass = await page.waitForSelector(
                'div.vidyard-player-container, iframe[src*="play.vidyard.com"], video',
                { timeout: 10000 }
              ).then(() => true).catch(() => false);
              errorDetails = pass ? '' : 'Vidyard player or iframe not found after modal opened';
              logger.info(`TC-07: Vidyard player check: ${pass ? 'Pass' : 'Fail'}`);
              if (!pass) {
                await logPageDom(page, url, 'TC-07');
                break;
              }

              const carousel = await page.$('.ge-product-carousel__geslider');
              if (carousel) {
                logger.info('TC-07: Carousel detected, validating slides');
                for (let i = 0; i < MAX_CAROUSEL_SLIDES; i++) {
                  const clicked = await clickNextCarouselButton(page);
                  if (!clicked) break;
                  const alertText = await page.$eval('.alert-content .alert-title', el => el.textContent).catch(() => '');
                  if (alertText && alertText.includes('Video Not Found')) {
                    pass = false;
                    errorDetails = 'Video Not Found in carousel slide';
                    logger.warn('TC-07: Video Not Found in carousel slide');
                    await logPageDom(page, url, 'TC-07');
                    break;
                  }
                }
              }
              break;
            }
            case 'TC-08': {
              logger.info(`TC-08: Starting for ${url}`);
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(500);

              const initialForms = await page.$$('form');
              const initialFormCount = initialForms.length;
              logger.info(`TC-08: Initial form count: ${initialFormCount}`);

              let contact = page.locator('button[name="Open Form Overlay"], a[name="Open Form Overlay"]').first();

              if (!(await contact.count())) {
                contact = page.locator('section.ge-category-hero button, section.campaign-hero__ctas-primary button, section.ge-category-hero a, section.campaign-hero__ctas-primary a')
                  .filter({ hasText: /contact|request|demander/i })
                  .first();
              }

              if (!(await contact.count())) {
                contact = page.locator('button').filter({ hasText: /contact|request|demander/i }).first();
              }
              if (!(await contact.count())) {
                contact = page.locator('a').filter({ hasText: /contact|request|demander/i }).first();
              }

              if (!(await contact.count())) {
                contact = page.locator('[data-analytics-link-type="Category Hero"], [data-analytics-link-type="Campaign Hero"], [data-analytics-link-type="Contact Widget"]')
                  .filter({ hasText: /contact|request|demander/i })
                  .first();
              }

              if (!(await contact.count())) {
                logger.warn('TC-08 `(8): No contact button or link found');
                pass = false;
                errorDetails = 'No contact button or link found';
                await logPageDom(page, url, 'TC-08');
                break;
              }

              logger.info(`TC-08: Found contact element: ${await contact.textContent()}`);

              try {
                await contact.waitFor({ state: 'visible', timeout: 20000 });
              } catch (e) {
                logger.warn('TC-08: Contact element not visible within 20 seconds');
                pass = false;
                errorDetails = 'Contact element not visible';
                await logPageDom(page, url, 'TC-08');
                break;
              }

              await contact.scrollIntoViewIfNeeded();
              await contact.click({ force: true });

              logger.info(`TC-08: Waiting for form count to increase`);
              pass = await page.waitForFunction(
                prevCount => document.querySelectorAll('form').length > prevCount,
                initialFormCount,
                { timeout: 12000 }
              ).then(() => true).catch(() => false);
              errorDetails = pass ? '' : `Form count did not increase (initial: ${initialFormCount}, current: ${await page.evaluate(() => document.querySelectorAll('form').length)})`;
              logger.info(`TC-08: Form count check: ${pass ? 'Pass' : 'Fail'}`);
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
              logger.info(`TC-10: Checking gatekeeper handling for ${url}`);
              logger.info(`TC-10: Gatekeeper detected: ${gatekeeperDetected}, HTTP status: ${resp ? resp.status() : 'N/A'}, Final URL: ${page.url()}`);
              pass = gatekeeperDetected && resp && resp.status() === 200;
              errorDetails = pass ? '' : gatekeeperDetected ? 
                `Page did not load successfully after gatekeeper (status: ${resp ? resp.status() : 'N/A'})` : 
                'Gatekeeper UI not detected when expected';
              if (!pass) await logPageDom(page, url, 'TC-10');
              logger.info(`TC-10: Result: ${pass ? 'Pass' : 'Fail'} (${errorDetails})`);
              break;
            }
            case 'TC-11': {
              logger.info(`TC-11: Starting for ${url}`);
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
                logger.warn(`TC-11: No valid link found`);
                await logPageDom(page, url, 'TC-11');
                break;
              }
              const targetUrl = new URL(selectedHref, page.url()).toString();
              logger.info(`TC-11: Navigating to ${targetUrl}`);
              const newPage = await contextToUse.newPage();
              const response = await newPage.goto(targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
              pass = !!response && response.status() === 200;
              errorDetails = pass ? '' : `Navigating to ${targetUrl} resulted in status ${response ? response.status() : 'N/A'}`;
              logger.info(`TC-11: Navigation result: ${pass ? 'Pass' : 'Fail'}`);
              if (!pass) await logPageDom(newPage, targetUrl, 'TC-11');
              await newPage.close();
              break;
            }
            case 'TC-12': {
              logger.info(`TC-12: Final URL: ${page.url()}`);
              const finalUrl = page.url();
              pass = finalUrl.includes('/account/doccheck-login');
              errorDetails = pass ? '' : `Expected redirect to "/account/doccheck-login" not found: ${finalUrl}`;
              if (!pass) await logPageDom(page, url, 'TC-12');
              break;
            }
            case 'TC-13': {
              logger.info(`TC-13: Starting for ${url}`);
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(500);

              const produkteButton = page.getByRole('button', { name: 'Produkte' }).first();
              try {
                await produkteButton.waitFor({ state: 'visible', timeout: 30000 });
                logger.info('TC-13: Produkte button found and visible');
              } catch (e) {
                logger.warn('TC-13: Produkte button not found or not visible within 30s');
                pass = false;
                errorDetails = 'Produkte button not found or not visible';
                await logPageDom(page, url, 'TC-13');
                break;
              }
              logger.info(`TC-13: Clicking Produkte button`);
              await produkteButton.click();

              let ultraschallButton = page.getByRole('button', { name: 'Ultraschall' });
              try {
                await ultraschallButton.waitFor({ state: 'visible', timeout: 10000 });
                logger.info('TC-13: Ultraschall submenu item found and visible via role');
              } catch (e) {
                logger.info('TC-13: Ultraschall not found via role, trying fallback');
                ultraschallButton = page.locator('.menu-content-container-item-data', { hasText: 'Ultraschall' });
                await ultraschallButton.waitFor({ state: 'visible', timeout: 5000 });
                if (!(await ultraschallButton.isVisible())) {
                  logger.warn('TC-13: Ultraschall submenu item not found or not visible within 15s');
                  pass = false;
                  errorDetails = 'Ultraschall submenu item not found or not visible';
                  await logPageDom(page, url, 'TC-13');
                  break;
                }
                logger.info('TC-13: Ultraschall submenu item found via fallback');
              }
              logger.info(`TC-13: Clicking Ultraschall submenu item`);
              await ultraschallButton.click();

              const moreLink = page.locator('a[href="https://www.ge-ultraschall.com/"]');
              try {
                await moreLink.waitFor({ state: 'visible', timeout: 30000 });
                logger.info('TC-13: Found "Mehr erfahren" link by href');
              } catch (error) {
                logger.info('TC-13: "Mehr erfahren" link not found by href within 30 seconds');
                const moreLinkByText = page.locator('a', { hasText: /> Mehr erfahren/i });
                await moreLinkByText.waitFor({ state: 'visible', timeout: 5000 });
                if (!(await moreLinkByText.isVisible())) {
                  logger.warn('TC-13: Fallback link not found or not visible');
                  pass = false;
                  errorDetails = '"Mehr erfahren" link not found or not visible';
                  await logPageDom(page, url, 'TC-13');
                  break;
                }
                logger.info('TC-13: Found "Mehr erfahren" link via text fallback');
              }

              logger.info(`TC-13: Clicking "Mehr erfahren" link`);
              await moreLink.scrollIntoViewIfNeeded();
              await moreLink.click();

              await page.waitForNavigation({ timeout: 30000 }).catch(() => {
                logger.info('TC-13: Navigation wait timed out, proceeding with current URL');
              });

              const dest = page.url();
              logger.info(`TC-13: Navigated to ${dest}`);
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
              logger.warn(errorDetails);
            }
          }
        } catch (err) {
          logger.error(`EXCEPTION for ${id}: ${err.message}`);
          pass = false;
          errorDetails = `Exception during test execution for ${id}: ${err.message}`;
          await logPageDom(page, url, id);
          const safeUrl = url.replace(/[^a-zA-Z0-9_-]/g, '_');
          const screenshotPath = `${SCREENSHOT_DIR}/${safeUrl}-${id}-exception.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true })
            .catch(screenshotErr => logger.error(`Screenshot failed during exception for ${id}: ${screenshotErr.message}`));
        } finally {
          if (id === 'TC-02') {
            await page.setViewportSize(DEFAULT_VIEWPORT);
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
        const screenshotPath = path.join(SCREENSHOT_DIR, screenshotFileName);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotUrl = await uploadFile(screenshotPath, `screenshots/${screenshotFileName}`);
        if (screenshotUrl) logger.info(`Screenshot uploaded: ${screenshotUrl}`);

        if (captureVideo) {
          const videoContext = await browser.newContext({
            recordVideo: { dir: VIDEO_DIR, timeout: 15000 },
            viewport: DEFAULT_VIEWPORT
          });
          const videoPage = await videoContext.newPage();
          await videoPage.goto(url, { waitUntil: 'domcontentloaded' });
          await videoPage.waitForTimeout(5000);
          const videoPath = await videoPage.video().path();
          await videoContext.close();
          const uniqueId = uuidv4();
          const videoFileName = `${safeUrl}-${uniqueId}.webm`;
          const finalVideoPath = path.join(VIDEO_DIR, videoFileName);
          await fs.promises.rename(videoPath, finalVideoPath);
          videoUrl = await uploadFile(finalVideoPath, `videos/${videoFileName}`);
          if (videoUrl) logger.info(`Video uploaded: ${videoUrl}`);
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
        if (updateError) logger.error('Error updating test results with media URLs:', JSON.stringify(updateError, null, 2));
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
      logger.info(`✔ ${(Date.now() - t0) / 1000}s`);
      await page.close();
      if (contextToUse !== context) await contextToUse.close();
    }

    // Process URLs in batches with concurrency control
    const urlBatches = [];
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      urlBatches.push(urls.slice(i, i + CONCURRENCY));
    }

    for (let batchIndex = 0; batchIndex < urlBatches.length; batchIndex++) {
      const batch = urlBatches[batchIndex];
      logger.info(`\n➡ Batch ${batchIndex + 1}/${urlBatches.length}`);
      await Promise.all(
        batch.map((urlData, j) =>
          pTimeout(runUrl(urlData, batchIndex * CONCURRENCY + j), 90000, `URL processing timeout for ${urlData.url}`)
            .catch(async (err) => {
              logger.error(`Timeout or error for ${urlData.url}: ${err.message}`);
              results[batchIndex * CONCURRENCY + j]['Page Pass?'] = 'Fail';
              if (results[batchIndex * CONCURRENCY + j]['HTTP Status'] === '-') {
                results[batchIndex * CONCURRENCY + j]['HTTP Status'] = 'Timeout/Error';
              }
              await updateProgress(batchIndex * CONCURRENCY + j + 1, startTime);
            })
        )
      );
      if (batchIndex < urlBatches.length - 1) {
        logger.info('Waiting 5 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
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

    logger.info(`\nSummary: ${passed}/${total} pages passed, ${failed} failed, ${na} N/A.`);
    const testFailureSummary = {};
    allTestIds.forEach(id => {
      const f = results.filter(r => r[id] === 'Fail').length;
      if (f > 0) {
        logger.info(`• ${f} × ${id}`);
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
    logger.info(`\n✅ Results saved → ${outputFile}\n`);

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
      video_paths: allVideoUrls,
      environment
    };

    const summaryFilePath = 'summary.json';
    fs.writeFileSync(summaryFilePath, JSON.stringify(payload, null, 2));
    logger.info(`Run summary saved to ${summaryFilePath}`);

    const storeRunBaseUrl = process.env.VERCEL_URL && !process.env.VERCEL_URL.startsWith('http')
      ? `https://${process.env.VERCEL_URL}`
      : process.env.VERCEL_URL || 'http://localhost:3000';
    const storeRunUrl = `${storeRunBaseUrl}/api/store-run`;
    logger.info(`Sending run summary to ${storeRunUrl}`);
    try {
      const response = await fetch(storeRunUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`Failed to store run: ${response.status} ${response.statusText}`, errorBody);
      } else {
        logger.info('Successfully stored run summary via API.');
      }
    } catch (apiError) {
      logger.error('Error sending run summary to API:', apiError.message);
    }

    await context.close();
    await browser.close();

    logger.info('Script completed successfully. Exiting with code 0.');
    process.exit(0);
  } catch (error) {
    logger.error('Fatal error:', JSON.stringify(error, null, 2));
    process.exit(1);
  }
})();