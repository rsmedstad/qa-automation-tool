/*───────────────────────────────────────────────────────────────────────────────
  ask-llm.js
  ----------
  • Uses Google's Gemini API with streaming for real-time responses
  • Fetches crawl results and test definitions from Supabase for context
  • Validates passphrase and environment variables at startup
  • Triggers crawls only for user-specified external URLs with improved parsing
  • Enhanced logging to debug API failures
  • Added query length logging to check for potential token limit issues
───────────────────────────────────────────────────────────────────────────────*/

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
require('dotenv').config();

// Validate Supabase environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL || !SUPABASE_URL.startsWith('http')) {
  console.error(`Invalid SUPABASE_URL: ${SUPABASE_URL}`);
  throw new Error(`Invalid SUPABASE_URL: ${SUPABASE_URL}`);
}
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}
// Singleton Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Fetches summaries of the last 3 crawl runs from Supabase.
 * @returns {string} - Summaries of recent crawls or an error message.
 */
async function getLatestCrawlSummary() {
  try {
    const { data: recentRuns, error } = await supabase
      .from('test_runs')
      .select('run_id, created_at, initiated_by')
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) {
      console.error('Supabase fetch error for recent runs:', error);
      return 'Error fetching crawl data from Supabase.';
    }
    if (!recentRuns.length) {
      console.log('No recent crawl data found in Supabase.');
      return 'No recent crawl data available.';
    }

    console.log('Fetched recent runs:', recentRuns);
    let summary = '';
    for (const run of recentRuns) {
      const { data: results, error: resultsError } = await supabase
        .from('test_results')
        .select('url, test_id, result')
        .eq('run_id', run.run_id);
      if (resultsError) {
        console.error(`Supabase fetch error for test results of run ${run.run_id}:`, resultsError);
        continue;
      }
      const urlResults = {};
      results.forEach(r => {
        if (!urlResults[r.url]) urlResults[r.url] = { pass: true, failedTests: [] };
        if (r.result === 'fail') {
          urlResults[r.url].pass = false;
          urlResults[r.url].failedTests.push(r.test_id);
        }
      });
      const total = Object.keys(urlResults).length;
      const failed = Object.values(urlResults).filter(r => !r.pass).length;
      summary += `Run ID: ${run.run_id}, Date: ${run.created_at}, Initiated by: ${run.initiated_by}\n- Total Pages: ${total}\n- Failed Pages: ${failed}\n`;
    }
    console.log('Crawl summary generated:', summary);
    return summary;
  } catch (err) {
    console.error('Error fetching crawl summaries:', {
      message: err.message,
      stack: err.stack,
    });
    return 'Error fetching crawl data.';
  }
}

/**
 * Fetches all test definitions for context.
 * @returns {string} - Formatted test definitions or an error message.
 */
async function getTestDefinitions() {
  try {
    const { data, error } = await supabase
      .from('test_definitions')
      .select('test_id, description');
    if (error) {
      console.error('Supabase fetch error for test definitions:', error);
      return 'Error fetching test definitions from Supabase.';
    }
    console.log('Fetched test definitions:', data);
    return data.map(def => `- **${def.test_id}**: ${def.description}`).join('\n');
  } catch (err) {
    console.error('Error fetching test definitions:', {
      message: err.message,
      stack: err.stack,
    });
    return 'Error fetching test definitions.';
  }
}

/**
 * Main handler: either triggers a crawl or queries Gemini with streaming.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { question, passphrase } = req.body;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const STORED_PASSPHRASE = process.env.GEMINI_PASSPHRASE;

  // Passphrase & API key checks
  if (!STORED_PASSPHRASE || passphrase.trim() !== STORED_PASSPHRASE.trim()) {
    console.log('Passphrase validation failed:', {
      provided: passphrase,
      expected: STORED_PASSPHRASE,
    });
    return res.status(401).json({ message: 'Invalid passphrase' });
  }
  if (!GEMINI_KEY) {
    console.error('GEMINI_API_KEY is not set in environment variables');
    return res.status(500).json({ message: 'Server configuration error: API key missing' });
  }
  if (!question || typeof question !== 'string') {
    console.error('Invalid question:', question);
    return res.status(400).json({ message: 'Invalid or missing question' });
  }

  try {
    console.log('Processing question:', question);

    // Detect crawl intent
    const urlRegex = /(https?:\/\/)?([\w\.-]+\.[a-z]{2,})(\/[^\s]*)?/i;
    const crawlKeywords = /\b(run|crawl|execute)\b.*\btest(s)?\b/i;
    const hasCrawlIntent = crawlKeywords.test(question) && urlRegex.test(question);

    if (hasCrawlIntent) {
      // Extract URL
      const urlMatch = question.match(urlRegex);
      let targetUrl = urlMatch[0];
      if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

      // Extract Test IDs
      const tcIds = Array.from(new Set([
        ...(question.match(/\bTC-\d+\b/gi) || []),
        ...[...question.matchAll(/\btest (\d+)\b/gi)].map(m => {
          const n = parseInt(m[1], 10);
          return `TC-${n < 10 ? '0' + n : n}`;
        }),
      ]));

      const payload = [{
        url: targetUrl,
        testIds: tcIds.join(','),
        region: '',
      }];

      console.log('Triggering crawl with payload:', payload);
      const fetcher = (await import('node-fetch')).default;
      const triggerRes = await fetcher(
        `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/trigger-crawl`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payload, initiator: 'Gemini-User', passphrase }),
        }
      );
      const triggerJson = await triggerRes.json();
      console.log('Crawl trigger response:', triggerJson);
      if (!triggerRes.ok) {
        console.error('Crawl trigger failed:', triggerJson);
        return res.status(500).json({ message: triggerJson.message || 'Failed to initiate crawl' });
      }
      return res.status(200).json({
        answer: `Crawl initiated (Run ID: ${triggerJson.runId}). It is now running. Use the dashboard to check status.`,
      });
    }

    // No crawl intent → fetch context & query Gemini with streaming
    console.log('Fetching crawl summary for context...');
    const summary = await getLatestCrawlSummary();
    console.log('Fetching test definitions for context...');
    const defs = await getTestDefinitions();
    const systemMessage = `You are an AI assistant for the QA Automation Tool. Use:
- Recent Crawl Details:
  ${summary}
- Test Definitions:
  ${defs}
**Note**: “Test 1” maps to “TC-01”, etc.`;
    const fullPrompt = `${systemMessage}\n\nUser Question: ${question}`;

    // Log prompt size to check for potential token limit issues
    console.log('Full prompt length (characters):', fullPrompt.length);
    console.log('Full prompt preview (first 500 chars):', fullPrompt.substring(0, 500));

    console.log('Initializing Google Generative AI client...');
    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    console.log('Sending request to Google API...');
    const result = await model.generateContentStream(fullPrompt);
    console.log('Google API request sent, streaming response...');

    let text = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      console.log('Received chunk:', chunkText);
      text += chunkText;
    }

    console.log('Final response from Google API:', text);
    res.status(200).json({ answer: text.trim() });
  } catch (err) {
    console.error('Error in ask-llm handler:', {
      message: err.message,
      stack: err.stack,
      status: err.status,
      response: err.response ? err.response.data : null,
    });
    res.status(500).json({ message: 'Failed to process request', error: err.message });
  }
}