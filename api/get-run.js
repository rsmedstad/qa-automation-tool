// api/get-runs.js
// Retrieves up to 120 QA run records from Vercel KV for the dashboard

const { kv } = require('@vercel/kv');

/**
 * Handles GET requests to fetch all stored QA runs.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object to send back run data.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Fetch the list of runIds (up to 120)
    const runIds = await kv.lrange('runs', 0, 119);

    // Retrieve run data for each runId
    const runs = await Promise.all(
      runIds.map(async (id) => {
        const data = await kv.get(`run:${id}`);
        return JSON.parse(data);
      })
    );

    res.status(200).json(runs);
  } catch (error) {
    console.error('Error fetching runs:', error);
    res.status(500).json({ message: 'Failed to fetch runs' });
  }
}