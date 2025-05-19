import fetch from 'node-fetch';

const KV_REST_API_URL = process.env.KV_REST_API_URL?.replace(/\/+$/, '');
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const CUTOFF_DAYS = 60;

async function listKeys(cursor = '') {
  const url = new URL(`${KV_REST_API_URL}/keys`);
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('limit', '100');

  console.log(`[DEBUG] Listing keys from: ${url.toString()}`);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to list keys: ${res.status} ${res.statusText} - ${errorBody}`);
  }

  return res.json(); // { keys: [], cursor: '...' }
}

async function getKeyValue(key) {
  const url = `${KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  console.log(`[DEBUG] Fetching key value: ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to get key value for ${key}: ${res.status} ${res.statusText} - ${errorBody}`);
  }

  return res.json(); // { result: "..." }
}

async function batchDeleteKeys(keys) {
  const url = `${KV_REST_API_URL}/del`;
  console.log(`[DEBUG] Batch deleting ${keys.length} keys`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(keys)
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to batch delete keys: ${res.status} ${res.statusText} - ${errorBody}`);
  }

  const result = await res.json();
  console.log(`Deleted ${result.result.length} keys.`);
  return result.result;
}

async function cleanup() {
  console.log('Starting Vercel KV cleanup...');
  const cutoffDate = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000);
  let cursor = '';
  let totalDeleted = 0;

  try {
    do {
      const { keys, cursor: nextCursor } = await listKeys(cursor);
      const keysToDelete = [];

      for (const keyName of keys) {
        try {
          const valueResp = await getKeyValue(keyName);
          const jsonStr = valueResp.result;

          if (!jsonStr) {
            console.warn(`No value for key: ${keyName}`);
            continue;
          }

          let parsed;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            console.warn(`Invalid JSON in key ${keyName}, skipping`);
            continue;
          }

          const keyDateStr = parsed.date;
          if (!keyDateStr) {
            console.warn(`No "date" field in key ${keyName}, skipping`);
            continue;
          }

          const keyDate = new Date(keyDateStr);
          if (keyDate < cutoffDate) {
            keysToDelete.push(keyName);
          }
        } catch (e) {
          console.error(`Error processing key ${keyName}:`, e.message);
        }
      }

      if (keysToDelete.length > 0) {
        const deletedKeys = await batchDeleteKeys(keysToDelete);
        totalDeleted += deletedKeys.length;
      }

      cursor = nextCursor;
    } while (cursor);

    console.log(`Vercel KV cleanup complete. Total keys deleted: ${totalDeleted}`);
  } catch (err) {
    console.error('Cleanup error:', err.message);
    process.exit(1);
  }
}

cleanup();
