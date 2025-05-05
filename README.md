# GEHC QA Testing

This repository provides an automated QA testing tool using the `qa-test.js` script and an `input.xlsx` file. The tool runs Playwright-based tests on specified URLs and generates an output spreadsheet (`results-*.xlsx`) summarizing the results.

---

## 🧪 Test Definitions

Each URL in the `input.xlsx` file specifies one or more tests to run using the **Test IDs** column in the **"URLs"** tab. Use a comma-separated list (e.g., `TC-01,TC-03,TC-05`) to indicate which tests to apply.

| **Test ID** | **Description**                         | **Test Method** |
|-------------|-----------------------------------------|-----------------|
| **TC-01**   | Hero overlay on desktop                 | Check `div[id*="ge-homepage-hero"] div[style]` for `position:absolute` in a headless desktop browser (1280×800). |
| **TC-02**   | Hero below banner on mobile             | Ensure same element **does not** have `position:absolute` using a mobile browser (Pixel 5). |
| **TC-03**   | Header presence                         | Look for `<header>` or `div[class*="header"]` in desktop context. |
| **TC-04**   | Nav presence                            | Look for `<nav>` or `div[class*="nav"]` in desktop context. |
| **TC-05**   | Main content presence                   | Look for `<main>` or `div[class*="main"]` in desktop context. |
| **TC-06**   | Footer presence                         | Look for `<footer>` or `div[class*="footer"]` in desktop context. |
| **TC-07**   | Main video (Vidyard) present            | Check for `<iframe src*="vidyard">` or `<video>` in desktop context. |
| **TC-08**   | Contact-Us form overlay loads           | Click `button.button--primary` or `.ge-contact-us-button__contactus-action-button`, then confirm overlay form appears. |
| **TC-09**   | Declared Rendering Error                | Check if the page content contains the text "A rendering error occurred." If not found, the test passes. |
| **TC-10**   | Gatekeeper interstitial appears         | Load page with no cookies, confirm redirect with `/gatekeeper?` in URL. |
| **TC-11**   | Insights first article link works       | Click first link inside `div[class*="insights-list"] a`, await navigation, check for HTTP 200. |
| **TC-12**   | DocCheck login redirect for gated pages | Load gated page without cookies, confirm URL includes `/account/doccheck-login`. |
| **TC-13**   | DE nav-link redirect (301)              | Click `text=Mehr erfahren` on DE homepage, confirm redirect to `https://www.ge-ultraschall.com/`. |
| **TC-14**   | Status code validation                  | Ensure HTTP status is 200 or a valid/expected redirect (301/302). |

---

## ⚙️ Running the QA Tests

### 1. **Prepare `input.xlsx`**
- Open the **"URLs"** tab.
- Ensure columns: `URL`, `Region`, and `Test IDs` exist.
- In **"Test IDs"**, list which tests to run per URL (e.g., `TC-01,TC-03`).

### 2. **Trigger the Workflow**
- Use the `run-qa.yml` GitHub Actions workflow.
- Upload the updated `input.xlsx`.
- The script runs selected tests and generates:
  - `results-<run_id>.xlsx`
  - `screenshots-<run_id>` (only on failure)

### 3. **Review Results**
- Download `results-<run_id>` from GitHub Actions artifacts.
- Open the **"Results"** sheet to view:
  - Test outcomes
  - HTTP status
  - Pass/fail summary
- Check `screenshots-<run_id>` for images of failed tests.

---

## 🔧 Adjusting the Test Scope

To change which tests apply to a specific URL:

1. Edit the **"Test IDs"** column in the `URLs` tab of `input.xlsx`.
2. Specify desired test cases, e.g.: TC-01,TC-03

---

## 🔍 For More Detail

Refer to:
- [`qa-test.js`](./qa-test.js) — Contains the Playwright test logic.
- [`run-qa.yml`](./.github/workflows/run-qa.yml) — GitHub Actions workflow configuration.
