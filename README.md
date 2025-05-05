QA Testing for GE Healthcare Websites
This document outlines the automated QA testing process for GE Healthcare websites using the qa-test.js script and input.xlsx file. The script runs Playwright tests on specified URLs and generates a results spreadsheet (results-*.xlsx).
Test Definitions
The following tests are applied to URLs based on the "Test IDs" column in the "URLs" tab of input.xlsx. Each URL specifies which tests to run by listing the relevant Test IDs (e.g., "TC-01,TC-03,TC-05").



Test ID
Description
Test Method



TC-01
Hero overlay on desktop
In a headless desktop browser (1280×800 UA), select div[id*="ge-homepage-hero"] div[style] and verify its style contains position:absolute.


TC-02
Hero below banner on mobile
In a headless mobile browser (Pixel 5 UA), select the same div[id*="ge-homepage-hero"] div[style] and verify its style does not contain position:absolute.


TC-03
Header presence
In desktop context, check for any <header> tag or <div> whose class includes "header" via page.$('header, div[class*="header"]').


TC-04
Nav presence
In desktop context, check for any <nav> tag or <div> whose class includes "nav" via page.$('nav, div[class*="nav"]').


TC-05
Main content presence
In desktop context, check for any <main> tag or <div> whose class includes "main" via page.$('main, div[class*="main"]').


TC-06
Footer presence
In desktop context, check for any <footer> tag or <div> whose class includes "footer" via page.$('footer, div[class*="footer"]').


TC-07
Main video (Vidyard) present
In desktop context, check for <iframe[src*="vidyard"] or <video> via page.$('iframe[src*="vidyard"], video').


TC-08
Contact-Us form overlay loads
In desktop context, click button.button--primary, button.ge-contact-us-button__contactus-action-button, then verify div.ge-contact-us-button__overlay-container form exists.


TC-09
Gatekeeper interstitial appears
Load the page without cookies, then verify page.url().includes('/gatekeeper?') to confirm the Gatekeeper redirect.


TC-10
Insights first article link works
On the insights listing, click the first link div[class*="insights-list"] a, await navigation, and verify the new page loads with HTTP 200.


TC-11
DocCheck login redirect for gated pages
Load each gated URL without cookies and verify page.url().includes('/account/doccheck-login') to confirm DocCheck redirect.


TC-12
DE nav-link redirect (301)
On the DE homepage, click text=Mehr erfahren, await redirect, and verify page.url().startsWith('https://www.ge-ultraschall.com/').


TC-13
Confirms 200 status page for results except for 301/302 redirects that were expected
If not 200 status, ensure expected for URL (e.g., 2xx or 301/302 redirects).


Running the QA Tests

Prepare input.xlsx:

Ensure the "URLs" tab contains columns: "URL," "Region," and "Test IDs."
List the applicable test IDs for each URL in the "Test IDs" column (e.g., "TC-01,TC-03,TC-05").


Run the Workflow:

Trigger the GitHub Actions workflow (run-qa.yml) with the updated input.xlsx.
The script will run the specified tests for each URL and generate a results-*.xlsx file.


Review Results:

Download the results-<run_id> artifact from GitHub Actions.
Check the "Results" sheet for test outcomes, HTTP status, and overall pass/fail status.
If any tests fail, review the screenshots-<run_id> artifact for screenshots of failed tests.



Adjusting Test Scope
To adjust which tests run for a specific URL:

Edit the "Test IDs" column in the "URLs" tab of input.xlsx.
For example, to run only TC-01 and TC-03 for a URL, set "Test IDs" to "TC-01,TC-03".

For more details, refer to the qa-test.js script and run-qa.yml workflow configuration.
