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

async function batchDeleteKeys(keys) {
  const url = `${KV_REST_API_URL}/del`;
  console.log(`[DEBUG] DEL ${keys.length} keys`);
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
  console.log(`Deleted ${result.length} keys`);
  return result;
}

async function cleanup() {
  console.log('Starting Vercel KV cleanup...');
  const cutoffTime = Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  let cursor = 0;
  let totalDeleted = 0;

  try {
    do {
      const { keys, cursor: nextCursor } = await listKeys(cursor);
      const toDelete = [];

      for (const key of keys) {
        try {
          const { result: jsonStr } = await getKeyValue(key);
          if (!jsonStr) continue;
          let obj;
          try { obj = JSON.parse(jsonStr); } catch { continue; }
          if (obj.date && new Date(obj.date).getTime() < cutoffTime) {
            toDelete.push(key);
          }
        } catch (e) {
          console.error(`Error reading ${key}:`, e.message);
        }
      }

      if (toDelete.length) {
        const deleted = await batchDeleteKeys(toDelete);
        totalDeleted += deleted.length;
      }
      cursor = nextCursor;
    } while (cursor !== 0);

    console.log(`Cleanup complete. Total keys deleted: ${totalDeleted}`);
  } catch (err) {
    console.error('Fatal cleanup error:', err);
    process.exit(1);
  }
}

cleanup();
