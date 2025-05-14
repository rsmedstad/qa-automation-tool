/*───────────────────────────────────────────────────────────────────────────────
  ask-llm.js
  ----------
  • Uses Google's Gemini API with streaming for real-time responses
  • Fetches crawl results and test definitions from Supabase for context
  • Validates passphrase and environment variables at startup
  • Triggers crawls only for user-specified external URLs with improved parsing
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
    if (error || !recentRuns.length) return 'No recent crawl data available.';

    let summary = '';
    for (const run of recentRuns) {
      const { data: results } = await supabase
        .from('test_results')
        .select('url, test_id, result')
        .eq('run_id', run.run_id);
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
    return summary;
  } catch (err) {
    console.error('Error fetching crawl summaries:', err.message);
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
      console.error('Error fetching test definitions:', error);
      return 'Error fetching test definitions.';
    }
    return data.map(def => `- **${def.test_id}**: ${def.description}`).join('\n');
  } catch (err) {
    console.error('Error fetching test definitions:', err.message);
    return 'Error fetching test definitions.';
  }
}

/**
 * Main handler: either triggers a crawl or queries Gemini with streaming.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { question, passphrase } = req.body;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const STORED_PASSPHRASE = process.env.GEMINI_PASSPHRASE;

  // Passphrase & API key checks
  if (!STORED_PASSPHRASE || passphrase.trim() !== STORED_PASSPHRASE.trim()) {
    console.log('Passphrase validation failed');
    return res.status(401).json({ message: 'Invalid passphrase' });
  }
  if (!GEMINI_KEY) {
    console.error('GEMINI_API_KEY is not set');
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
        })
      ]));

      const payload = [{
        url: targetUrl,
        testIds: tcIds.join(','),
        region: ''
      }];

      console.log('Triggering crawl with:', payload);
      const fetcher = (await import('node-fetch')).default;
      const triggerRes = await fetcher(
        `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/trigger-crawl`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payload, initiator: 'Gemini-User', passphrase })
        }
      );
      const triggerJson = await triggerRes.json();
      if (!triggerRes.ok) {
        return res.status(500).json({ message: triggerJson.message || 'Failed to initiate crawl' });
      }
      return res.status(200).json({
        answer: `Crawl initiated (Run ID: ${triggerJson.runId}). It is now running. Use the dashboard to check status.`
      });
    }

    // No crawl intent → fetch context & query Gemini with streaming
    const summary = await getLatestCrawlSummary();
    const defs = await getTestDefinitions();
    const systemMessage = `You are an AI assistant for the QA Automation Tool. Use:
- Recent Crawl Details:
  ${summary}
- Test Definitions:
  ${defs}
**Note**: “Test 1” maps to “TC-01”, etc.`;
    const fullPrompt = `${systemMessage}\n\nUser Question: ${question}`;

    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContentStream(fullPrompt);
    let text = '';
    for await (const chunk of result.stream) {
      text += chunk.text();
    }
    res.status(200).json({ answer: text.trim() });
  } catch (err) {
    console.error('Error in ask-llm handler:', err.message, err.stack);
    res.status(500).json({ message: 'Failed to process request', error: err.message });
  }
}