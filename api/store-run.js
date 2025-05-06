// api/store-run.js
// Stores QA run data in Vercel KV and limits storage to 120 runs

const { kv } = require('@vercel/kv');

/**
 * Handles POST requests to store QA run data in Vercel KV.
 * @param {Object} req - The request object containing run data.
 * @param {Object} res - The response object to send back status.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const runData = req.body; // Expected: { runId, crawlName, date, successCount, failureCount, initiator }
  const runId = runData.runId;

  try {
    // Store the run data in Vercel KV with key `run:<runId>`
    await kv.set(`run:${runId}`, JSON.stringify(runData));

    // Add runId to the list of runs
    await kv.lpush('runs', runId);

    // Limit to 120 runs by trimming older entries
    const runs = await kv.lrange('runs', 0, 119); // Get latest 120 runs
    if (runs.length > 120) {
      const oldestRunId = runs[runs.length - 1];
      await kv.del(`run:${oldestRunId}`); // Delete oldest run data
      await kv.ltrim('runs', 0, 119);     // Keep only latest 120 runIds
    }

    res.status(200).json({ message: 'Run stored successfully' });
  } catch (error) {
    console.error('Error storing run:', error);
    res.status(500).json({ message: 'Failed to store run' });
  }
}