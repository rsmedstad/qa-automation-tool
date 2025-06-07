// api/store-run.js
import { kv } from '@vercel/kv';

// Maximum number of runs to store in KV
const MAX_RUNS = 120;

/**
 * Handles POST requests to store QA run data in Vercel KV.
 * 
 * @param {Object} req - The request object containing run data.
 * @param {Object} res - The response object to send back status.
 */
export default async function handler(req, res) {
  // Log incoming request for debugging
  console.log('Request received:', { method: req.method, body: req.body });

  // Restrict to POST requests only
  if (req.method !== 'POST') {
    console.error('Method not allowed:', req.method);
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Extract run data and runId from request body
  const runData = req.body;
  const runId = runData.runId;

  // Validate presence of runId
  if (!runId) {
    console.error('Missing runId in request body');
    return res.status(400).json({ message: 'runId is required' });
  }

  try {
    // Store run data in KV with key `run:<runId>`
    await kv.set(`run:${runId}`, JSON.stringify(runData));

    // Add runId to the list of runs
    await kv.lpush('runs', runId);

    // Trim the list to keep only the most recent MAX_RUNS entries
    const runsToTrim = await kv.lrange('runs', MAX_RUNS, -1);
    for (const oldRunId of runsToTrim) {
      await kv.del(`run:${oldRunId}`);
    }
    await kv.ltrim('runs', 0, MAX_RUNS - 1);

    // Log success and respond
    console.log(`Run ${runId} stored successfully`);
    return res.status(200).json({ message: 'Run stored successfully' });
  } catch (error) {
    // Log detailed error and respond with failure
    console.error('Error storing run:', error.stack || error.message);
    return res.status(500).json({ message: 'Failed to store run', details: error.message });
  }
}
