/*───────────────────────────────────────────────────────────────────────────────
  ask-llm.js
  ----------
  • Uses Google's Gemini API with function calling for crawl initiation
  • Fetches crawl results and test definitions from Supabase for context
  • Implements short-term chat history using Vercel KV (last 6 turns, 1-hour TTL)
  • Validates passphrase and environment variables at startup
  • Implements confirmation layer via function calls instead of direct crawl triggers
  • Uses Gemini 1.5 Flash (configurable to 2.5 if available)
  • Enhanced prompt engineering for clarity and confirmation prompts
  • Formatted context for better readability
  • Adjusted temperature for deterministic responses
  • Improved error handling and logging
  • Truncated large datasets to avoid token limits
───────────────────────────────────────────────────────────────────────────────*/

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';
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

// Function schema for crawl initiation
const initiateCrawlFunction = {
  name: "initiate_crawl",
  description: "Initiate a QA crawl with the specified parameters.",
  parameters: {
    type: "OBJECT",
    properties: {
      urls: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "List of URLs to crawl",
      },
      test_ids: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "List of test case IDs to run",
      },
      initiator: {
        type: "STRING",
        description: "Name of the person initiating the crawl",
      },
    },
    required: ["urls", "test_ids", "initiator"],
  },
};

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
      summary += `- Run ID: ${run.run_id}, Crawl: QA Run, Date: ${run.created_at}, Success: ${total - failed}, Failures: ${failed}, Initiator: ${run.initiated_by}\n`;
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
      .select('test_id, title, description, test_method, screamingfrog_feature, screamingfrog_method, category');
    if (error) {
      console.error('Supabase fetch error for test definitions:', error);
      return 'Error fetching test definitions from Supabase.';
    }
    console.log('Fetched test definitions:', data);
    if (!data.length) {
      return 'No test definitions available.';
    }
    return data.map(def => {
      return `Test ID: ${def.test_id}\nTitle: ${def.title}\nDescription: ${def.description}\nCategory: ${def.category}\nHow it's tested (Method): ${def.test_method}\nScreaming Frog Feature: ${def.screamingfrog_feature}\nScreaming Frog Method: ${def.screamingfrog_method}\n---`;
    }).join('\n');
  } catch (err) {
    console.error('Error fetching test definitions:', {
      message: err.message,
      stack: err.stack,
    });
    return 'Error fetching test definitions.';
  }
}

/**
 * Main handler: processes user questions, detects crawl intent via function calling,
 * and returns either a confirmation prompt or an informational response.
 * Now includes short-term chat history using Vercel KV.
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

    // Get or create sessionId from cookies
    let sessionId = req.cookies.sessionId;
    if (!sessionId) {
      sessionId = uuidv4();
      res.setHeader('Set-Cookie', `sessionId=${sessionId}; Path=/; HttpOnly; Max-Age=3600`);
    }

    // Fetch conversation history from Vercel KV (default to empty array if none exists)
    const history = (await kv.get(`chat:${sessionId}`)) || [];

    // Fetch context for Gemini
    console.log('Fetching crawl summary for context...');
    const summary = await getLatestCrawlSummary();
    console.log('Fetching test definitions for context...');
    const defs = await getTestDefinitions();

    // Format recent runs and test definitions
    const recentRunsFormatted = summary.trim() || 'No recent crawl data available.';
    const testDefinitionsFormatted = defs.trim() || 'No test definitions available.';

    // Enhanced system message with function calling instructions
    const systemMessage = `You are an AI assistant for the QA Automation Tool. Users may ask questions about performing QA/Tests on URLs or about specific test cases (TCs). Your role is to provide information about these tests based on the provided definitions or analyze past results if available in the context. You cannot execute new tests directly.

If the user explicitly requests to start a crawl with action verbs like 'start,' 'initiate,' or 'run,' and provides the necessary details (URLs, test cases, initiator name), call the 'initiate_crawl' function with the appropriate parameters. Do not initiate crawls automatically without explicit intent and always prompt for confirmation in your response (e.g., "Please confirm with 'yes,' 'start,' or 'proceed' to initiate the crawl."). Otherwise, provide an informational response based on the context.

For example, do not suggest specific Selenium commands or Python scripts. Only describe the steps or logic of a test as outlined in its definition.

If a user asks to perform a QA test without sufficient details, respond with: "I understand you're asking to test [URL(s)] for [Test Case(s)]. Please provide the URLs, test cases (e.g., TC-01), and your name to initiate the crawl. For example, say: 'Start a crawl on https://example.com with TC-01, TC-02 initiated by [Your Name].'"

Use the following context:
RECENT QA RUNS:
${recentRunsFormatted}

AVAILABLE TEST DEFINITIONS:
${testDefinitionsFormatted}

**Note**: “Test 1” maps to “TC-01”, etc.`;

    // Construct messages array with history and new prompt
    let messages = [
      { role: 'system', content: systemMessage },
      ...history.map(item => ({ role: item.role, content: item.content })),
      { role: 'user', content: question },
    ];

    console.log('Full prompt with history:', messages);

    // Check total prompt length and truncate if necessary
    const MAX_PROMPT_LENGTH = 4000; // Adjust based on Gemini's token limit
    let totalLength = messages.reduce((acc, msg) => acc + msg.content.length, 0);
    if (totalLength > MAX_PROMPT_LENGTH) {
      console.warn('Prompt exceeds maximum length, truncating...');
      let truncatedMessages = [];
      let currentLength = systemMessage.length; // Always include system message
      truncatedMessages.push(messages[0]); // System message

      // Add history and user prompt, prioritizing recent messages
      for (let i = messages.length - 1; i > 0; i--) {
        const msg = messages[i];
        if (currentLength + msg.content.length <= MAX_PROMPT_LENGTH) {
          truncatedMessages.unshift(msg);
          currentLength += msg.content.length;
        } else {
          break;
        }
      }
      messages = truncatedMessages;
    }

    console.log('Initializing Google Generative AI client...');
    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    // Using gemini-2.5-flash; check Gemini API docs for gemini-2.5-flash availability
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash', // Adjust to 'gemini-2.5-flash' if available
      temperature: 0.2,
    });

    console.log('Sending request to Google API...');
    let result;
    try {
      result = await model.generateContent({
        contents: messages.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] })),
        tools: [{ functionDeclarations: [initiateCrawlFunction] }],
      });
    } catch (apiError) {
      console.error('Gemini API call failed:', {
        message: apiError.message,
        stack: apiError.stack,
        response: apiError.response ? apiError.response.data : null,
      });
      throw new Error(`Gemini API call failed: ${apiError.message}`);
    }
    console.log('Google API request sent.');

    const response = result.response;
    const functionCalls = response.functionCalls();

    let assistantMsg;
    if (functionCalls && functionCalls.length > 0) {
      const functionCall = functionCalls[0];
      if (functionCall.name === 'initiate_crawl') {
        const args = functionCall.args;
        // Validate parameters
        if (args.urls && args.test_ids && args.initiator) {
          console.log('Crawl intent detected with parameters:', args);

          // Update history with the user message (but not the function call response yet)
          const newHistory = [
            ...history,
            { role: 'user', content: question },
          ].slice(-6);
          await kv.set(`chat:${sessionId}`, newHistory, { ex: 3600 });

          res.status(200).json({
            action: 'confirm_crawl',
            parameters: {
              urls: args.urls,
              test_ids: args.test_ids,
              initiator: args.initiator,
            },
            message: 'Please confirm with "yes," "start," or "proceed" to start the crawl with the specified parameters.',
          });
          return;
        } else {
          console.error('Invalid parameters for crawl initiation:', args);
          res.status(400).json({ message: 'Invalid parameters for crawl initiation. Please provide URLs, test IDs, and initiator.' });
          return;
        }
      } else {
        console.error('Unexpected function call:', functionCall.name);
        res.status(500).json({ message: 'Unexpected function call from Gemini.' });
        return;
      }
    } else {
      assistantMsg = response.text();
      console.log('Final response from Google API:', assistantMsg);
    }

    // Update history with both user and assistant messages
    const newHistory = [
      ...history,
      { role: 'user', content: question },
      { role: 'assistant', content: assistantMsg },
    ].slice(-6); // Keep last 6 entries (3 turns)

    // Store updated history in Vercel KV with 1-hour TTL
    await kv.set(`chat:${sessionId}`, newHistory, { ex: 3600 });

    res.status(200).json({ answer: assistantMsg });
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