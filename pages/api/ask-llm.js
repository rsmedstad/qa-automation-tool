// pages/api/ask-llm.js

import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Define system prompt template
const systemTemplate = `You are the QA Automation Tool assistant, designed to help users understand and interact with the QA Automation Tool. This tool automates web application testing by running predefined tests on specified URLs to ensure they meet quality standards in areas like page structure, functionality, and performance.

**Conversation History:**
{history}

**Recent QA Runs:**
{recentRuns}

**Test Definitions (only include fields the user requests):**
{testDefsSection}

**Response Style:**
{styleInstr}

**Guidelines:**
- Focus on test IDs (e.g., TC-01 or “test 1”) when providing information.
- Only include Screaming Frog (SF) details if explicitly asked.
- If a user asks about testing with external tools like Screaming Frog, provide general guidance or direct them to the "Test Definitions & Protocol" section for manual testing steps.
- When explaining tests, include technical details such as how the test is implemented (e.g., DOM queries, specific checks) and why the test is important for web quality assurance, unless the user requests a simple explanation.
- If a user asks about a test not in the current definitions, acknowledge the limitation and suggest checking the dashboard or contacting support for more information.

**Example Response for External Tools:**
"If you're looking to test locally with Screaming Frog, you can use its Custom Extraction feature to replicate some of our tests. For example, to mimic Test TC-03, you would set up a custom extraction to find <header> elements or classes containing 'header'. Please note that Screaming Frog requires a paid license for advanced features. For detailed steps, refer to the 'Screaming Frog' tab in the 'Test Definitions & Protocol' section of the dashboard."

**Additional Context:**
- The QA Automation Tool uses Playwright for browser automation, which allows it to interact with web pages and check for specific elements or behaviors.
- Tests are defined in a structured format, including a test ID, title, description, and method. The method often involves specific DOM queries or checks for certain conditions.
- The dashboard provides visual trends and insights into test results, helping teams identify and address issues quickly.

Remember, your goal is to provide helpful, detailed, and accurate information about the QA Automation Tool and its tests. If you're unsure about a specific detail, it's okay to say so and suggest where the user might find more information.
`;

// Create the chat prompt template
const prompt = ChatPromptTemplate.fromMessages([
  ['system', systemTemplate],
  ['human', '{question}'],
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { question, passphrase } = req.body;

  // Validate passphrase
  if (passphrase !== process.env.GEMINI_PASSPHRASE) {
    return res.status(401).json({ message: 'Invalid passphrase' });
  }

  // Check required env vars
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.GEMINI_API_KEY
  ) {
    return res.status(500).json({ message: 'Server config error: missing env vars' });
  }

  // Basic question validation
  if (question.trim().length < 3) {
    return res
      .status(400)
      .json({ message: 'Please ask about a specific test or run!' });
  }

  try {
    // Determine style instruction
    const isLayman = /simple|layman/i.test(question);
    const styleInstr = isLayman
      ? 'Explain in plain, non-technical terms.'
      : 'Provide detailed technical explanations, including how tests are implemented and why they are important, unless explicitly requested otherwise.';

    // Fetch recent runs
    let recentRuns = 'None.';
    try {
      const { data: runs, error } = await supabase
        .from('test_runs')
        .select('run_id, created_at, initiated_by')
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      if (runs?.length) {
        recentRuns = runs
          .map(
            (r) =>
              `• ${r.run_id} on ${new Date(r.created_at).toLocaleString()} by ${
                r.initiated_by || 'N/A'
              }`
          )
          .join('\n');
      }
    } catch (err) {
      console.error('Error loading runs:', err);
    }

    // Load history
    let sessionId = req.cookies.sessionId;
    if (!sessionId) {
      sessionId = uuidv4();
      res.setHeader(
        'Set-Cookie',
        `sessionId=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict`
      );
    }
    const rawHistory = (await kv.get(`chat:${sessionId}`)) || [];
    const history = rawHistory
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
      .join('\n');

    // Fetch and filter test definitions
    let testDefsSection = 'None found.';
    try {
      const { data: defs, error } = await supabase
        .from('test_definitions')
        .select(
          'test_id, title, description, test_method, screamingfrog_feature, screamingfrog_method'
        );
      if (error) throw error;

      // Parse explicit mentions of TC-## or "test ##"
      const mentioned = new Set();
      const tcRe = /\bTC-?0*([1-9]\d*)\b/gi;
      const tRe = /\btest\s+0*([1-9]\d*)\b/gi;
      let m;
      while ((m = tcRe.exec(question))) mentioned.add(`TC-${m[1].padStart(2, '0')}`);
      while ((m = tRe.exec(question))) mentioned.add(`TC-${m[1].padStart(2, '0')}`);

      // If "test" or "TC" is in the query or history, also capture standalone numbers
      const containsTest = /test|TC/i.test(question) || /test|TC/i.test(history);
      if (containsTest) {
        const numRe = /\b0*([1-9]\d*)\b/g;
        while ((m = numRe.exec(question))) {
          mentioned.add(`TC-${m[1].padStart(2, '0')}`);
        }
      }

      if (defs?.length) {
        let filtered = defs;
        if (mentioned.size) {
          filtered = defs.filter((d) => mentioned.has(d.test_id.toUpperCase()));
        } else {
          filtered = defs.slice(0, 5);
        }
        if (filtered.length) {
          const includeSF = /screaming\s+frog/i.test(question);
          testDefsSection = filtered
            .map((d) => {
              let out = `ID: ${d.test_id}\nTitle: ${d.title}\nDescription: ${d.description}\nMethod: ${d.test_method}`;
              if (includeSF) {
                out += `\nSF Feature: ${d.screamingfrog_feature}\nSF Method: ${d.screamingfrog_method}`;
              }
              return out;
            })
            .join('\n\n');
        }
      }
    } catch (err) {
      console.error('Error loading defs:', err);
    }

    // Rate limiting: max 10 requests/min
    const rateKey = `rate:${sessionId}`;
    const rate = (await kv.get(rateKey)) || 0;
    if (rate >= 10) {
      return res
        .status(429)
        .json({ message: 'Too many requests—please slow down.' });
    }
    await kv.set(rateKey, rate + 1, { ex: 60 });

    // Initialize Gemini model
    const model = new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      model: 'gemini-2.0-flash',
      temperature: 0.2,
    });

    // Create the chain using LCEL
    const chain = prompt.pipe(model);

    // Invoke the chain with all input variables
    const response = await chain.invoke({
      history,
      recentRuns,
      testDefsSection,
      styleInstr,
      question,
    });
    const answer = response.content.trim();

    // Persist updated history
    const newHist = rawHistory
      .concat({ role: 'user', content: question }, { role: 'assistant', content: answer })
      .slice(-6);
    await kv.set(`chat:${sessionId}`, newHist, { ex: 3600 });

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('Error in ask-llm:', err);
    return res.status(500).json({ message: 'AI generation failed', details: err.message });
  }
}
