// pages/api/ask-llm.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

// —————————————————————————————
// Supabase client setup
// —————————————————————————————
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL?.startsWith('http')) {
  console.error(`Invalid SUPABASE_URL: ${SUPABASE_URL}`);
  throw new Error('Invalid SUPABASE_URL');
}
if (!SUPABASE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// —————————————————————————————
// Helpers: fetch last 3 runs & test definitions
// —————————————————————————————
async function getLatestCrawlSummary() {
  try {
    const { data: runs, error } = await supabase
      .from('test_runs')
      .select('run_id, created_at, initiated_by')
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) throw error;
    if (!runs || !runs.length) return 'No recent crawl data available.';

    let summary = '';
    for (const run of runs) {
      const { data: results, error: resultsError } = await supabase
        .from('test_results')
        .select('url, test_id, result')
        .eq('run_id', run.run_id);
      if (resultsError) throw resultsError;

      const urlMap = {};
      if (results) {
        results.forEach(r => {
          urlMap[r.url] = urlMap[r.url] || { pass: true };
          if (r.result === 'fail') urlMap[r.url].pass = false;
        });
      }
      const total = Object.keys(urlMap).length;
      const failed = Object.values(urlMap).filter(r => !r.pass).length;
      summary += `- Run ID: ${run.run_id}, Date: ${run.created_at}, Success: ${total - failed}, Failures: ${failed}, Initiator: ${run.initiated_by || 'N/A'}\n`;
    }
    return summary;
  } catch (err) {
    console.error('Error fetching crawl summaries:', err);
    return 'Error fetching crawl data.';
  }
}

async function getTestDefinitions() {
  try {
    const { data, error } = await supabase
      .from('test_definitions')
      .select('test_id, title, description, test_method, screamingfrog_feature, screamingfrog_method, category');
    if (error) throw error;
    if (!data || !data.length) return 'No test definitions available.';

    return data
      .map(d => `
Test ID: ${d.test_id}
Title: ${d.title}
Description: ${d.description}
Category: ${d.category}
Method: ${d.test_method}
Screaming Frog Feature: ${d.screamingfrog_feature}
Screaming Frog Method: ${d.screamingfrog_method}
---
`.trim())
      .join('\n\n');
  } catch (err) {
    console.error('Error fetching test definitions:', err);
    return 'Error fetching test definitions.';
  }
}

// —————————————————————————————
// Main API handler
// —————————————————————————————
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { question, passphrase } = req.body;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const STORED_PASSPHRASE = process.env.GEMINI_PASSPHRASE;

  if (!STORED_PASSPHRASE || !passphrase || passphrase.trim() !== STORED_PASSPHRASE.trim()) {
    return res.status(401).json({ message: 'Invalid passphrase' });
  }
  if (!GEMINI_KEY) {
    console.error('Server configuration error: missing Gemini API key');
    return res.status(500).json({ message: 'Server configuration error: missing Gemini API key' });
  }
  if (!question || typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ message: 'Invalid or missing question' });
  }

  let sessionId = req.cookies?.sessionId;
  if (!sessionId) {
    sessionId = uuidv4();
    // Add SameSite attribute for better security
    res.setHeader(
      'Set-Cookie',
      `sessionId=${sessionId}; Path=/; HttpOnly; Max-Age=3600; SameSite=Lax`
    );
  }
  const historyFromKV = (await kv.get(`chat:${sessionId}`)) || [];

  // —————————————————————————————
  // Build system instruction text (formerly systemMessage)
  // —————————————————————————————
  const summary = await getLatestCrawlSummary();
  const definitions = await getTestDefinitions();
  const systemInstructionText = `
You are an AI assistant for the QA Automation Tool.
Users ask about QA tests (e.g. "TC-01") or past run results.
Always answer based on the tests and context provided; do not run code.

RECENT QA RUNS:
${summary}

AVAILABLE TEST DEFINITIONS:
${definitions}
`.trim();

  // —————————————————————————————
  // Assemble `contents` for Gemini API
  // History roles must be 'user' or 'model'. System instructions are separate.
  // —————————————————————————————
  const contentsForApi = [
    // Map history to the format expected by Gemini API
    ...historyFromKV.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user', // Map 'assistant' to 'model'
      parts: [{ text: msg.content }],
    })),
    // Add current user question
    {
      role: 'user',
      parts: [{ text: question }],
    },
  ];

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    // systemInstruction can also be set here if it's static for the model instance
    // e.g., systemInstruction: systemInstructionText
  });

  let assistantResponseText;
  try {
    const generationResult = await model.generateContent({
      contents: contentsForApi,
      systemInstruction: systemInstructionText, // Pass the system instructions as a string
      generationConfig: {
        temperature: 0.2,
      },
    });

    // Extract the assistant’s reply text
    // Accessing response safely
    if (generationResult.response &&
        generationResult.response.candidates &&
        generationResult.response.candidates.length > 0 &&
        generationResult.response.candidates[0].content &&
        generationResult.response.candidates[0].content.parts &&
        generationResult.response.candidates[0].content.parts.length > 0) {
      assistantResponseText = generationResult.response.candidates[0].content.parts[0].text;
    } else {
      // Handle cases where the response might be blocked or empty
      console.error('Gemini API returned an unexpected or empty response structure:', JSON.stringify(generationResult.response));
      let S_errorMessage = "Sorry, I couldn't get a valid response from the AI.";
      if (generationResult.response && generationResult.response.promptFeedback) {
        S_errorMessage = `Request blocked due to: ${generationResult.response.promptFeedback.blockReason || 'Safety concerns'}`;
        console.error('Prompt Feedback:', generationResult.response.promptFeedback);
      } else if (generationResult.response && generationResult.response.candidates && generationResult.response.candidates.length > 0) {
        const candidate = generationResult.response.candidates[0];
        if (candidate.finishReason && candidate.finishReason !== "STOP") {
          S_errorMessage = `Gemini API finished with reason: ${candidate.finishReason}.`;
          console.error('Finish Reason:', candidate.finishReason, candidate.safetyRatings ? `Safety Ratings: ${JSON.stringify(candidate.safetyRatings)}` : '');
        }
      }
      return res.status(500).json({ message: S_errorMessage, details: generationResult.response });
    }

  } catch (err) {
    console.error('Gemini API error:', err);
    let detailedErrorMessage = err.message;
    if (err.status && err.statusText) { // For GoogleGenerativeAIFetchError like objects
        detailedErrorMessage = `[${err.status} ${err.statusText}] ${err.message}`;
        if(err.errorDetails) detailedErrorMessage += ` Details: ${JSON.stringify(err.errorDetails)}`;
    }
    return res.status(500).json({ message: 'Gemini API call failed', error: detailedErrorMessage });
  }

  // —————————————————————————————
  // Persist updated history (keep last 6 interactions = 3 pairs of user/assistant)
  // —————————————————————————————
  const newHistory = [
    ...historyFromKV,
    { role: 'user', content: question },
    { role: 'assistant', content: assistantResponseText }, // Storing 'assistant' role locally is fine
  ].slice(-6); // Keep up to 3 full exchanges (user + assistant = 1 exchange)
  await kv.set(`chat:${sessionId}`, newHistory, { ex: 3600 }); // ex is in seconds for expiration

  // —————————————————————————————
  // Return final answer
  // —————————————————————————————
  res.status(200).json({ answer: assistantResponseText });
}