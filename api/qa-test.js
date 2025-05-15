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

// Corrected dotenv import for ES modules
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

try {
  (async () => {
    console.log('Starting QA test script');
    const [,, inputFile, outputFile, initiatedBy] = process.argv;
    // Check if process.argv[4] exists before accessing its value
    const captureVideo = process.argv[5] ? process.argv[5].toLowerCase() === 'true' : false; // Use index 5 for the optional argument

    if (!inputFile || !outputFile || !initiatedBy) {
      console.error('Usage: node api/qa-test.js <input.xlsx> <output.xlsx> <Initiated By> [captureVideo=false]');
      process.exit(1);
    }

    console.log(`\n▶ Workbook  : ${inputFile}`);
    console.log(`▶ Output    : ${outputFile}`);
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
    // Ensure headers are properly extracted, handle potential null/undefined
    const headers = headerRow.values.slice(1).map(h => h ? h.toString() : '').filter(h => h !== null);
    console.log('Headers:', headers);

    const testIdsIndex = headers.findIndex(h => h.toLowerCase() === 'test ids');
    if (testIdsIndex === -1) {
      console.error('Column "Test IDs" not found in URLs sheet.');
      process.exit(1);
    }

    const urlJsonData = [];
    urlSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowData = {};
      headers.forEach((header, index) => {
        // Use cell.value directly, handling potential RichText or null
        const cellValue = row.getCell(index + 2).value; // Adjusted index by +1 for 1-based indexing, and +1 again for slice(1)
        rowData[header] = cellValue && typeof cellValue === 'object' && cellValue.richText ?
          cellValue.richText.map(rt => rt.text).join('') :
          (cellValue === null || cellValue === undefined ? '' : cellValue);
      });
      urlJsonData.push(rowData);
    });
    console.log('First 5 rows of URLs sheet:', urlJsonData.slice(0, 5));


    const urls = urlJsonData.map(row => ({
      url: row['URL'],
      testIds: (row[headers[testIdsIndex]] || '').toString().split(',').map(id => id.trim()).filter(Boolean), // Ensure testIds is a string before split
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
        note: 'QA test run initiated via script' // Updated note
      });
    if (testRunError) {
      console.error('Error creating test run:', testRunError.message || testRunError); // Enhanced logging
      console.error('Supabase error details:', testRunError.details || 'No details available');
      console.error('Supabase error code:', testRunError.code || 'No code available');
      // For this script, let's exit as storing results is dependent on runId
      process.exit(1);
    }
    console.log(`Test Run created with ID: ${runId}`);


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
      // Enhanced logging for the specific error
      console.error('Error creating crawl progress:', progressError.message || progressError);
      console.error('Supabase error details:', progressError.details || 'No details available');
      console.error('Supabase error code:', progressError.code || 'No code available');
      // The original code logged but continued. If this error is fatal to the run's progress tracking,
      // uncomment the next line to ensure the GH Action fails.
      // process.exit(1); // Leaving commented out as per original logic, but be aware this might lead to inconsistent results if progress fails.
    }

    const screenshotDir = 'screenshots';
    const videoDir = 'videos';
    // Ensure directories exist
    if (!fs.existsSync(screenshotDir)) {
      try {
        fs.mkdirSync(screenshotDir);
      } catch (err) {
        console.error(`Error creating screenshot directory ${screenshotDir}: ${err.message}`);
      }
    }
    if (!fs.existsSync(videoDir)) {
      try {
        fs.mkdirSync(videoDir);
      } catch (err) {
        console.error(`Error creating video directory ${videoDir}: ${err.message}`);
      }
    }


    const browser = await chromium.launch();
    // Only record video if captureVideo is true
    const contextOptions = captureVideo ? { recordVideo: { dir: videoDir } } : {};
    const context = await browser.newContext(contextOptions);


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
        // Use a more robust click simulation
        el.click();
        return true;
      }, selector);
    }

    async function uploadFile(filePath, destPath) {
      if (!fs.existsSync(filePath)) {
        console.error(`File not found for upload: ${filePath}`);
        return null;
      }
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const blob = await put(destPath, fileBuffer, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        // Clean up local file after upload
        fs.unlinkSync(filePath);
        return blob.url;
      } catch (error) {
        console.error(`Error uploading file ${filePath}: ${error.message}`);
        return null;
      }
    }


    async function updateProgress(completed, startTime) {
      const now = new Date();
      const elapsedMs = now - new Date(startTime);
      // Prevent division by zero if no URLs completed yet
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
          estimated_done: estimatedDone === 'N/A' ? null : estimatedDone, // Store null if N/A
          status_summary: statusSummary
        })
        .eq('run_id', runId);

      if (error) {
        console.error('Error updating crawl progress:', error.message || error); // Enhanced logging
        console.error('Supabase error details:', error.details || 'No details available');
        console.error('Supabase error code:', error.code || 'No code available');
      }
    }

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
          screenshot_path: screenshotUrl, // Use URL directly
          video_path: videoUrl           // Use URL directly
        });
      if (error) {
        console.error(`Error inserting test result for ${testId} on ${url}:`, error.message || error); // Enhanced logging
        console.error('Supabase error details:', error.details || 'No details available');
        console.error('Supabase error code:', error.code || 'No code available');
      }
    }

    async function runUrl(urlData, idx) {
      const url = urlData.url;
      const testIds = urlData.testIds;
      const region = urlData.data['Region'] || 'N/A';
      console.log(`[${idx + 1}/${urls.length}] ${url}`);
      const t0 = Date.now();

      // Use a new page for each URL to ensure isolation
      const page = await context.newPage();
      let resp;
      let pageError = null;

      try {
        // Increase timeout for navigation
        resp = await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
        console.log(`Page loaded for ${url}, status: ${resp ? resp.status() : 'N/A'}`);
      } catch (error) {
        console.log(`Navigation error for ${url}: ${error.message}`);
        pageError = `Navigation failed: ${error.message}`;
        results[idx]['HTTP Status'] = 'Navigation Error';
        // Skip tests if navigation failed critically
        const validTestIds = testIds.filter(id => allTestIds.includes(id)); // Still use valid test IDs
        for (const id of validTestIds) {
          results[idx][id] = 'Fail'; // Mark as fail due to navigation
          await insertTestResult(url, region, id, 'fail', `Navigation failed: ${error.message}`, null, null);
        }
        // Mark invalid test IDs as NA
        testIds.filter(id => !allTestIds.includes(id)).forEach(id => {
          results[idx][id] = 'NA';
        });

        await page.close();
        await updateProgress(idx + 1, startTime);
        console.log(`     ❌ Failed navigation ${(Date.now() - t0) / 1000}s`);
        return; // Skip the rest of the test execution for this URL
      }


      results[idx]['HTTP Status'] = resp ? resp.status() : 'N/A';
      const failedTestIds = [];

      const validTestIds = testIds.filter(id => allTestIds.includes(id));
      if (testIds.length !== validTestIds.length) {
        const invalid = testIds.filter(id => !allTestIds.includes(id)).join(', ');
        console.log(`   Warning: Invalid test IDs [${invalid}] ignored.`);
        // Log invalid tests as N/A in results
        testIds.filter(id => !allTestIds.includes(id)).forEach(id => {
          results[idx][id] = 'NA';
        });
      }

      for (const id of allTestIds) {
        if (!validTestIds.includes(id)) continue;

        let pass = false;
        let errorDetails = '';
        try {
          switch (id) {
            case 'TC-01': {
              // Check for any element with position absolute within the hero section
              const hasAbsolute = await page.evaluate(() => {
                const hero = document.querySelector('section.ge-homepage-hero-v2-component');
                if (!hero) return false;
                return Array.from(hero.querySelectorAll('*')).some(el => {
                  const style = getComputedStyle(el);
                  return style.position === 'absolute' && style.display !== 'none' && style.visibility !== 'hidden';
                });
              });
              pass = !hasAbsolute; // Pass if NO elements with absolute position are found
              errorDetails = hasAbsolute ? 'Found element with position: absolute in hero' : '';
              break;
            }
            case 'TC-02': {
              // Check for inline style 'position: absolute' on elements within specific hero divs
              const hasInlineAbsolute = await page.evaluate(() => {
                const elements = document.querySelectorAll('div[id*="ge-homepage-hero"] div[style]');
                return Array.from(elements).some(el => {
                  const style = el.getAttribute('style');
                  return style && /position\s*:\s*absolute/i.test(style);
                });
              });
              pass = !hasInlineAbsolute; // Pass if NO elements with inline position: absolute are found
              errorDetails = hasInlineAbsolute ? 'Found element with inline style position: absolute in hero' : '';
              break;
            }
            case 'TC-03': {
              // Check for existence of header element
              pass = !!(await page.$('header, [class*="header"]'));
              errorDetails = pass ? '' : 'Header element not found';
              break;
            }
            case 'TC-04': {
              // Check for existence of nav element
              pass = !!(await page.$('nav, [class*="nav"]'));
              errorDetails = pass ? '' : 'Navigation element not found';
              break;
            }
            case 'TC-05': {
              // Check for existence of main element
              pass = !!(await page.$('main, [class*="main"]'));
              errorDetails = pass ? '' : 'Main content element not found';
              break;
            }
            case 'TC-06': {
              // Check for existence of footer element
              pass = !!(await page.$('footer, [class*="footer"]'));
              errorDetails = pass ? '' : 'Footer element not found';
              break;
            }
            case 'TC-07': {
              // Check for video playback
              await page.waitForLoadState('networkidle', { timeout: 30000 });
              if (await page.$('video, video[data-testid="hls-video"], iframe[src*="vidyard"]')) {
                pass = true;
                break;
              }
              const clickSel = await scrollAndFind(page, [
                '.ge-contentTeaser__content-section__contentTeaserHero-play-icon',
                '.eds-rd-play', '.eds-rd-play-icon',
                'div[data-testid="splashScreen"]',
                '.ge-contentTeaser__content-section__contentTeaserHero__img-container'
              ], 5); // Reduced maxScreens for performance
              if (!clickSel) { pass = false; errorDetails = 'Play button/element not found'; break; }
              await jsClick(page, clickSel);
              const modal = await page.waitForSelector('div.ge-modal-window, div.ge-modal-window-wrapper', { timeout: 10000 }).catch(() => null); // Reduced timeout
              if (!modal) { pass = false; errorDetails = 'Video modal did not open'; break; }
              pass = await page.waitForSelector('div.vidyard-player-container, iframe[src*="play.vidyard.com"]', { timeout: 10000 }).then(() => true).catch(() => false); // Reduced timeout
              errorDetails = pass ? '' : 'Vidyard player or iframe not found after modal opened';
              break;
            }
            case 'TC-08': {
              // Check if Contact Us form opens
              const cookieBanner = await page.$('#_evidon_banner');
              if (cookieBanner) {
                const declineButton = await page.$('#_evidon-decline-button');
                if (declineButton && await declineButton.isVisible()) { // Check visibility
                  await declineButton.click();
                  await page.waitForTimeout(500); // Shorter wait
                }
              }
              const initialForms = await page.$$('form');
              const initialFormCount = initialForms.length;

              const contactButtonSelector = 'button.ge-contact-us-button__contactus-action-button, a[href*="contact-us"]'; // Added alternative selector
              const contactButton = await page.waitForSelector(contactButtonSelector, { timeout: 10000 }).catch(() => null);

              if (!contactButton) { pass = false; errorDetails = 'Contact Us button not found'; break; }

              await jsClick(page, contactButtonSelector);

              // Wait for the number of forms to increase, indicating the modal/form appeared
              pass = await page.waitForFunction(prevCount => document.querySelectorAll('form').length > prevCount, initialFormCount, { timeout: 10000 }).then(() => true).catch(() => false);
              errorDetails = pass ? '' : `Number of forms did not increase after clicking Contact Us button (initial: ${initialFormCount}, current: ${await page.evaluate(() => document.querySelectorAll('form').length)})`;
              break;
            }
            case 'TC-09': {
              // Check for known rendering error text
              const errorText = 'A rendering error occurred';
              const pageContent = await page.content();
              pass = !pageContent.includes(errorText);
              errorDetails = pass ? '' : `Page content contains "${errorText}"`;
              break;
            }
            case 'TC-10': {
              // Check if the URL contains '/gatekeeper?'
              pass = !page.url().includes('/gatekeeper?'); // Pass if it does NOT contain gatekeeper
              errorDetails = pass ? '' : `URL contains "/gatekeeper?": ${page.url()}`;
              break;
            }
            case 'TC-11': {
              // Check if clicking an insights link goes to a 200 page
              const insightsLinkSelector = 'div[class*="insights-list"] a, .ge-newsroom-article-card a'; // Added newsroom card selector
              const insightsLink = await page.$(insightsLinkSelector);

              if (!insightsLink) {
                pass = false;
                errorDetails = 'No insights or newsroom link found';
                break;
              }

              // Open link in a new page to not affect the current page's state
              const href = await insightsLink.getAttribute('href');
              if (!href) {
                pass = false;
                errorDetails = 'Insights link has no href attribute';
                break;
              }

              // Construct absolute URL if href is relative
              const targetUrl = new URL(href, page.url()).toString();

              try {
                const newPage = await context.newPage();
                const response = await newPage.goto(targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
                pass = !!response && response.status() === 200;
                errorDetails = pass ? '' : `Navigating to ${targetUrl} resulted in status ${response ? response.status() : 'N/A'}`;
                await newPage.close();
              } catch (navError) {
                pass = false;
                errorDetails = `Navigation to insights link ${targetUrl} failed: ${navError.message}`;
              }
              break;
            }
            case 'TC-12': {
              // Check if the URL contains '/account/doccheck-login'
              pass = !page.url().includes('/account/doccheck-login'); // Pass if it does NOT contain doccheck-login
              errorDetails = pass ? '' : `URL contains "/account/doccheck-login": ${page.url()}`;
              break;
            }
            case 'TC-13': {
              // Check navigation to external ultrasound site from German site
              // This test is specific to a German locale or site structure
              const produkteLink = await page.$('span.ge-cdx-header-redesign__nav-menu-item__nav-link:has-text("Produkte")');
              if (!produkteLink) {
                pass = false; errorDetails = '"Produkte" link not found'; break;
              }
              await produkteLink.click();

              const ultraschallLink = await page.waitForSelector('div.menu-content-container-item-data:has-text("Ultraschall")', { timeout: 10000 }).catch(() => null);
              if (!ultraschallLink) {
                pass = false; errorDetails = '"Ultraschall" link not found in menu'; break;
              }
              await ultraschallLink.click();

              const moreLink = await page.waitForSelector('a:has-text("Mehr erfahren"), a[href*="ge-ultraschall"], a[href*="gehealthcare-ultrasound"]', { timeout: 10000 }).catch(() => null); // Added alternative selectors
              if (!moreLink) {
                pass = false; errorDetails = '"Mehr erfahren" or equivalent link not found'; break;
              }

              // Click and wait for navigation
              const [response] = await Promise.all([
                page.waitForNavigation({ timeout: 30000 }), // Increased timeout
                moreLink.click(),
              ]);

              const dest = page.url();
              pass = (dest.startsWith('https://www.ge-ultraschall.com/') || dest.startsWith('https://gehealthcare-ultrasound.com/')) && (response ? response.status() === 200 : true); // Check status too
              errorDetails = pass ? '' : `Navigation did not go to expected ultrasound site or resulted in non-200 status: ${dest}`;
              break;
            }
            case 'TC-14': {
              // Check main page HTTP status code
              const c = resp ? resp.status() : 0;
              pass = (c >= 200 && c < 300) || HTTP_REDIRECT.includes(c);
              errorDetails = pass ? '' : `HTTP Status was ${c}, expected 2xx or 3xx`;
              break;
            }
            default: {
              // Handle unexpected test IDs - should not happen with validTestIds filter, but as a safeguard
              pass = false;
              errorDetails = `Unsupported Test ID: ${id}`;
              console.warn(errorDetails);
            }
          }
        } catch (err) {
          console.log(`   EXCEPTION for ${id}: ${err.message}`);
          pass = false;
          errorDetails = `Exception during test execution for ${id}: ${err.message}`;
          // Capture screenshot on error
          const safeUrl = url.replace(/[^a-zA-Z0-9_-]/g, '_'); // More robust sanitization
          const screenshotPath = `${screenshotDir}/${safeUrl}-${id}-exception.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true })
            .catch(screenshotErr => console.error(`Screenshot failed during exception for ${id}: ${screenshotErr.message}`));
        }

        results[idx][id] = pass ? 'Pass' : 'Fail';
        const result = pass ? 'pass' : 'fail';
        // Store result immediately
        await insertTestResult(url, region, id, result, errorDetails, null, null);

        if (!pass) failedTestIds.push(id);
      }

      // Capture and upload media only if there were failures or captureVideo is true
      let screenshotUrl = null;
      let videoUrl = null;
      const safeUrl = url.replace(/[^a-zA-Z0-9_-]/g, '_'); // More robust sanitization

      if (failedTestIds.length > 0 || captureVideo) {
        try {
          // Wait for a moment to ensure rendering is complete before screenshot/video save
          await page.waitForTimeout(2000);

          if (failedTestIds.length > 0) {
            const screenshotFileName = `${safeUrl}-failed-${failedTestIds.join(',')}.png`;
            const screenshotPath = path.join(screenshotDir, screenshotFileName);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            screenshotUrl = await uploadFile(screenshotPath, `screenshots/${screenshotFileName}`);
            if (screenshotUrl) console.log(`Screenshot uploaded: ${screenshotUrl}`);
          }

          const video = page.video();
          if (video && captureVideo) { // Only upload video if captureVideo is true
            try {
              const videoFilePath = await video.path();
              // Wait for video to finish recording and be saved to disk
              await video.saveAs(path.join(videoDir, `${safeUrl}-${idx + 1}.webm`));
              const videoFileName = `${safeUrl}-${idx + 1}.webm`;
              const finalVideoPath = path.join(videoDir, videoFileName);
              videoUrl = await uploadFile(finalVideoPath, `videos/${videoFileName}`);
              if (videoUrl) console.log(`Video uploaded: ${videoUrl}`);
            } catch (videoError) {
              console.error(`Error saving or uploading video for ${url}: ${videoError.message}`);
            }
          } else if (video && !captureVideo) {
            // If video was recorded but not needed (no failures and captureVideo=false), delete it
            try {
              const videoFilePath = await video.path();
              if (fs.existsSync(videoFilePath)) {
                fs.unlinkSync(videoFilePath);
                console.log(`Deleted unnecessary video for ${url}`);
              }
            } catch (deleteError) {
              console.error(`Error deleting video for ${url}: ${deleteError.message}`);
            }
          }
        } catch (error) {
          console.error(`Failed to capture/upload media for ${url}: ${error.message}`);
        }
      } else {
        // Ensure any recorded video is deleted if not capturing video and no failures
        const video = page.video();
        if (video) {
          try {
            const videoFilePath = await video.path();
            if (fs.existsSync(videoFilePath)) {
              fs.unlinkSync(videoFilePath);
              console.log(`Deleted video for passing URL (captureVideo is false): ${url}`);
            }
          } catch (deleteError) {
            console.error(`Error deleting video for ${url}: ${deleteError.message}`);
          }
        }
      }


      // Update database with media URLs for failed tests
      if ((screenshotUrl || videoUrl) && failedTestIds.length > 0) {
        // Update only the results that failed for this specific URL in this run
        const { error: updateError } = await supabase
          .from('test_results')
          .update({
            screenshot_path: screenshotUrl,
            video_path: videoUrl
          })
          .eq('run_id', runId)
          .eq('url', url)
          .in('test_id', failedTestIds); // Update only failed tests

        if (updateError) {
          console.error('Error updating test results with media URLs:', updateError.message || updateError); // Enhanced logging
          console.error('Supabase error details:', updateError.details || 'No details available');
          console.error('Supabase error code:', updateError.code || 'No code available');
        }
      }


      // Determine overall page pass/fail status based on *relevant* tests
      const relevantTestResults = validTestIds.map(id => results[idx][id]);
      if (relevantTestResults.length === 0) {
        results[idx]['Page Pass?'] = 'NA'; // No relevant tests assigned
      } else if (relevantTestResults.includes('Fail')) {
        results[idx]['Page Pass?'] = 'Fail'; // Any relevant test failed
      } else {
        results[idx]['Page Pass?'] = 'Pass'; // All relevant tests passed or were N/A (shouldn't be N/A if validTestIds is used)
      }


      await updateProgress(idx + 1, startTime);
      console.log(`     ✔ ${(Date.now() - t0) / 1000}s`);
      await page.close();
    }

    const CONCURRENCY = 4; // Increased concurrency - adjust based on system resources and site tolerance
    const urlBatches = [];
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      urlBatches.push(urls.slice(i, i + CONCURRENCY));
    }

    for (let i = 0; i < urlBatches.length; i++) {
      const slice = urlBatches[i];
      console.log(`\n➡  Batch ${i * CONCURRENCY + 1}-${i * CONCURRENCY + slice.length}`);
      await Promise.all(slice.map((u, j) => runUrl(u, i * CONCURRENCY + j)));
    }


    // Final progress update
    await supabase
      .from('crawl_progress')
      .update({
        status: 'completed',
        estimated_done: new Date().toISOString(),
        status_summary: 'Your test is complete. Finalizing results.'
      })
      .eq('run_id', runId);


    const total = results.length;
    const passed = results.filter(r => r['Page Pass?'] === 'Pass').length;
    const failed = results.filter(r => r['Page Pass?'] === 'Fail').length;
    const na = results.filter(r => r['Page Pass?'] === 'NA').length;


    console.log(`\nSummary: ${passed}/${total} pages passed, ${failed} failed, ${na} N/A.`);
    const testFailureSummary = {};
    allTestIds.forEach(id => {
      const f = results.filter(r => r[id] === 'Fail').length;
      if (f > 0) {
        console.log(`  • ${f} × ${id}`);
        testFailureSummary[id] = f;
      }
    });


    const failedUrlsList = [];
    for (const result of results) {
      if (result['Page Pass?'] === 'Fail') {
        const failedTestsForUrl = allTestIds.filter(id => result[id] === 'Fail');
        failedUrlsList.push({ url: result['URL'], failedTests: failedTestsForUrl });
      }
    }


    // Construct and send payload to /api/store-run
    const payload = {
      runId: runId,
      crawlName: 'QA Run',
      date: new Date().toISOString(),
      successCount: passed,
      failureCount: failed,
      initiatedBy: initiatedBy,
      testFailureSummary: testFailureSummary, // Add test failure breakdown
      failedUrls: failedUrlsList // Add list of failed URLs and their failed tests
    };


    // Determine the base URL for the store-run API
    const storeRunBaseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null); // Use localhost in dev, null otherwise

    if (storeRunBaseUrl) {
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
      } catch (fetchError) {
        console.error('Error sending run summary to API:', fetchError.message);
      }
    } else {
      console.warn('VERCEL_URL is not set, and NODE_ENV is not development. Skipping sending run summary to /api/store-run.');
    }


    const outputWorkbook = new ExcelJS.Workbook();

    const resultSheet = outputWorkbook.addWorksheet('Results');
    // Ensure headers match the keys in the results objects
    const outputHeaders = [...headers, ...allTestIds, 'Page Pass?', 'HTTP Status'];
    resultSheet.getRow(1).values = outputHeaders;
    results.forEach((result, index) => {
      const rowData = outputHeaders.map(header => result[header]);
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

    // Write summary to local file for potential external use (e.g., GitHub Actions output)
    const summaryFilePath = 'summary.json';
    fs.writeFileSync(summaryFilePath, JSON.stringify(payload, null, 2)); // Write the same payload sent to API
    console.log(`Run summary saved to ${summaryFilePath}`);


    // Close the browser context and browser
    await context.close();
    await browser.close();


    process.exit(failed > 0 ? 1 : 0); // Exit with non-zero code if there were failures
  })();
} catch (error) {
  console.error('Fatal error caught in main try...catch:', error.message || error); // Enhanced logging
  console.error('Error details:', error.details || 'No details available');
  console.error('Error code:', error.code || 'No code available');
  console.error('Stack trace:', error.stack);
  process.exit(1); // Ensure script exits with error code on unexpected exceptions
}