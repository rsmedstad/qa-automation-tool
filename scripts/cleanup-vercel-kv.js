// Purges outdated keys from Vercel KV based on a 60-day cutoff
import fetch from 'node-fetch';

const KV_REST_API_URL = process.env.KV_REST_API_URL?.replace(/\/+$/, '');
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const CUTOFF_DAYS = 60;

/**
 * Calls the Upstash /scan endpoint.
 * cursor must be a number; returns { keys: string[], cursor: number }.
 */
async function listKeys(cursor = 0) {
  const url = `${KV_REST_API_URL}/scan`;
  const payload = {
    cursor,
    match: '*',
    count: 100
  };

  console.log(`[DEBUG] SCAN ${url} →`, payload);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SCAN failed: ${res.status} ${res.statusText} – ${body}`);
  }

  const { result, cursor: nextCursor } = await res.json();
  // Upstash returns nextCursor as a string sometimes, convert to number
  return { keys: result, cursor: Number(nextCursor) };
}

/**
 * Fetches the value of a specific key from Vercel KV.
 */
async function getKeyValue(key) {
  const url = `${KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${key} failed: ${res.status} ${res.statusText} – ${body}`);
  }
  return res.json(); // { result: "..." }
}

/**
 * Deletes a batch of keys from Vercel KV.
 */
async function batchDeleteKeys(keys) {
  const url = `${KV_REST_API_URL}/del`;
  console.log(`[DEBUG] DEL ${keys.length} keys:`, keys);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(keys)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DEL failed: ${res.status} ${res.statusText} – ${body}`);
  }
  const { result } = await res.json();
  console.log(`[INFO] Successfully deleted ${result.length} keys`);
  return result;
}

/**
 * Cleans up old keys from Vercel KV based on a 60-day cutoff.
 */
async function cleanup() {
  console.log('[INFO] Starting Vercel KV cleanup...');
  const cutoffTime = Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffTime).toISOString();
  console.log(`[INFO] Cutoff date: ${cutoffDate}`);
  let cursor = 0;
  let totalDeleted = 0;

  try {
    do {
      const { keys, cursor: nextCursor } = await listKeys(cursor);
      console.log(`[INFO] Found ${keys.length} keys in this batch`);
      const toDelete = [];

      for (const key of keys) {
        try {
          const { result: jsonStr } = await getKeyValue(key);
          if (!jsonStr) {
            console.log(`[INFO] Key ${key} has no value, skipping`);
            continue;
          }
          let obj;
          try {
            obj = JSON.parse(jsonStr);
          } catch (e) {
            console.log(`[WARN] Key ${key} has invalid JSON, skipping`);
            continue;
          }
          if (obj.date) {
            const keyDate = new Date(obj.date).getTime();
            if (keyDate < cutoffTime) {
              console.log(`[INFO] Key ${key} is older than cutoff, marking for deletion`);
              toDelete.push(key);
            } else {
              console.log(`[INFO] Key ${key} is newer than cutoff, keeping`);
            }
          } else {
            console.log(`[INFO] Key ${key} has no 'date' field, keeping`);
          }
        } catch (e) {
          console.error(`[ERROR] Failed to read key ${key}:`, e.message);
        }
      }

      if (toDelete.length) {
        const deleted = await batchDeleteKeys(toDelete);
        totalDeleted += deleted.length;
      } else {
        console.log('[INFO] No keys to delete in this batch');
      }
      cursor = nextCursor;
    } while (cursor !== 0);

    console.log(`[INFO] Cleanup complete. Total keys deleted: ${totalDeleted}`);
  } catch (err) {
    console.error('[ERROR] Fatal cleanup error:', err.message);
    process.exit(1);
  }
}

cleanup();
