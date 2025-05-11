/*───────────────────────────────────────────────────────────────────────────────
  ask-llm.js
  ----------
  • Uses Google's Gemini API to answer questions and summarize crawl data
  • Fetches and analyzes results.xlsx from the latest crawl for detailed page specifics
  • Validates passphrase before processing requests
───────────────────────────────────────────────────────────────────────────────*/

const { GoogleGenerativeAI } = require('@google/generative-ai');
const ExcelJS = require('exceljs');

/**
 * Fetches the latest results.xlsx artifact from GitHub Actions and extracts its data.
 * @param {Object} octokit - Initialized Octokit client.
 * @returns {Object} - Parsed Excel data or null if not found.
 */
async function fetchLatestResults(octokit) {
  try {
    console.log('Fetching latest workflow runs...');
    const { data } = await octokit.actions.listWorkflowRuns({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      workflow_id: 'run-qa.yml',
      status: 'success',
      per_page: 1
    });

    if (!data.workflow_runs.length) {
      console.log('No successful workflow runs found.');
      return null;
    }

    const latestRun = data.workflow_runs[0];
    console.log(`Processing latest run ID: ${latestRun.id}`);
    const artifactsResponse = await octokit.actions.listWorkflowRunArtifacts({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      run_id: latestRun.id
    });

    const resultsArtifact = artifactsResponse.data.artifacts.find(artifact => artifact.name.startsWith('results-'));
    if (!resultsArtifact) {
      console.log('No results artifact found for latest run.');
      return null;
    }

    console.log(`Downloading results artifact ${resultsArtifact.id}`);
    const download = await octokit.actions.downloadArtifact({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      artifact_id: resultsArtifact.id,
      archive_format: 'zip'
    });

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(Buffer.from(download.data));
    const zipEntries = zip.getEntries();
    const resultsEntry = zipEntries.find(entry => entry.entryName.endsWith('.xlsx'));
    if (!resultsEntry) {
      console.log('No results.xlsx found in artifact.');
      return null;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(resultsEntry.getData());
    const worksheet = workbook.getWorksheet('Results');
    if (!worksheet) {
      console.log('Results worksheet not found.');
      return null;
    }

    const headers = worksheet.getRow(1).values.slice(1);
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowData = {};
      headers.forEach((header, index) => {
        rowData[header] = row.getCell(index + 1).value;
      });
      rows.push(rowData);
    });

    console.log(`Extracted ${rows.length} rows from results.xlsx`);
    return { rows, runId: latestRun.id, runDate: latestRun.created_at };
  } catch (error) {
    console.error('Error fetching latest results:', error.message);
    return null;
  }
}

/**
 * Handles POST requests to query the Gemini AI assistant.
 * @param {Object} req - The request object with the user's question and passphrase.
 * @param {Object} res - The response object to send back the AI's answer.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { question, passphrase } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const storedPassphrase = process.env.GEMINI_PASSPHRASE;
  const githubToken = process.env.GITHUB_TOKEN;

  // Log for debugging
  console.log('Received passphrase:', passphrase);
  console.log('Stored passphrase:', storedPassphrase);

  // Validate passphrase
  if (!storedPassphrase || passphrase.trim() !== storedPassphrase.trim()) {
    console.log('Passphrase validation failed');
    return res.status(401).json({ message: 'Invalid passphrase' });
  }

  // Validate API key
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    return res.status(500).json({ message: 'Server configuration error: API key missing' });
  }

  // Validate GitHub token
  if (!githubToken) {
    console.error('GITHUB_TOKEN is not set');
    return res.status(500).json({ message: 'Server configuration error: GitHub token missing' });
  }

  // Validate question
  if (!question || typeof question !== 'string' || question.trim() === '') {
    console.error('Invalid question:', question);
    return res.status(400).json({ message: 'Invalid or missing question' });
  }

  try {
    console.log('Querying Gemini with question:', question);

    // Dynamically import dependencies
    const { Octokit } = await import('@octokit/rest');
    const fetch = (await import('node-fetch')).default;

    const octokit = new Octokit({ auth: githubToken });

    // Fetch latest results.xlsx
    const latestResults = await fetchLatestResults(octokit);

    // Prepare results summary for Gemini
    let resultsSummary = 'No recent crawl data available.';
    if (latestResults) {
      const { rows, runId, runDate } = latestResults;
      const failedPages = rows.filter(row => row['Page Pass?'] === 'Fail');
      const failedDetails = failedPages.map(row => {
        const failedTests = Object.keys(row)
          .filter(key => key.startsWith('TC-') && row[key] === 'Fail')
          .join(', ');
        return `- URL: ${row.URL}, Failed Tests: ${failedTests || 'None'}`;
      }).join('\n');

      resultsSummary = `Latest crawl (Run ID: ${runId}, Date: ${runDate}):\n- Total Pages: ${rows.length}\n- Failed Pages: ${failedPages.length}\n${failedDetails || 'No failures.'}`;
    }

    // Prepare system message with run summary and results data
    const systemMessage = `You are an AI assistant for the QA Automation Tool by rsmedstad. Answer succinctly using list format or style-enhancing elements when appropriate. For questions about 'runs', 'crawls', 'QAs', or tool performance, use the following data:
- Recent Crawl Details:
  ${resultsSummary}
- Resources for additional context:
  - Vercel Dashboard: https://qa-automation-tool.vercel.app/
  - GitHub Repo: https://github.com/rsmedstad/qa-automation-tool
  - GitHub Actions (QA Crawl): https://github.com/rsmedstad/qa-automation-tool/actions
  - Tests & Definitions (README.md): https://github.com/rsmedstad/qa-automation-tool/blob/main/README.md
  - Technical specifications: https://github.com/rsmedstad/qa-automation-tool/blob/main/api/qa-test.js
When answering questions about recent crawls, analyze the provided crawl data, highlighting specifics like failed URLs, failed tests, and patterns. If data lacks details, note that more information is in the artifacts. Provide concise, relevant answers using lists or structured formatting. Do not encourage users to leave the site; use the information to answer directly.`;

    const fullQuestion = `${systemMessage}\n\nUser Question: ${question}`;

    // Query Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent(fullQuestion);
    const response = await result.response;
    const text = await response.text();

    res.status(200).json({ answer: text.trim() });
  } catch (error) {
    console.error('Error querying Gemini:', error.message, error.stack);
    res.status(500).json({ message: 'Failed to get response from AI assistant', error: error.message });
  }
}