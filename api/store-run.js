// api/store-run.js
// Stores QA run data in Vercel KV and limits storage to 120 runs

const { kv } = require('@vercel/kv');
const MAX_RUNS = 120;

/**
 * Handles POST requests to store QA run data in Vercel KV.
 * @param {Object} req - The request object containing run data.
 * @param {Object} res - The response object to send back status.
 */
export default async function handler(req, res) {
  console.log('Received request method:', req.method);
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const runData = req.body; // Expected: { runId, crawlName, date, successCount, failureCount, initiator }
  const runId = runData.runId;

  if (!runId) {
    return res.status(400).json({ message: 'runId is required' });
  }

  try {
    // Store the run data in Vercel KV with key `run:<runId>`
    await kv.set(`run:${runId}`, JSON.stringify(runData));

    // Add runId to the list of runs
    await kv.lpush('runs', runId);

    // Get all run IDs that are older than the MAX_RUNS limit
    const runsToTrim = await kv.lrange('runs', MAX_RUNS, -1);

    for (const oldRunId of runsToTrim) {
      await kv.del(`run:${oldRunId}`); // Delete oldest run data
    }

    // Keep only the latest MAX_RUNS runIds in the list
    await kv.ltrim('runs', 0, MAX_RUNS - 1);

    res.status(200).json({ message: 'Run stored successfully' });
  } catch (error) {
    console.error('Error storing run:', error);
    res.status(500).json({ message: 'Failed to store run', details: error.message });
  }
}